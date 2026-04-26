/**
 * Service for AI-powered project selection for resumes.
 */

import { LlmService } from "./llm/service";
import type { JsonSchemaDefinition } from "./llm/types";
import { resolveLlmModel } from "./modelSelection";
import { loadPrompt } from "./prompts";
import type { ResumeProjectSelectionItem } from "./resumeProjects";

/** JSON schema for project selection response */
const PROJECT_SELECTION_SCHEMA: JsonSchemaDefinition = {
  name: "project_selection",
  schema: {
    type: "object",
    properties: {
      selectedProjectIds: {
        type: "array",
        items: { type: "string" },
        description: "List of project IDs to include on the resume",
      },
    },
    required: ["selectedProjectIds"],
    additionalProperties: false,
  },
};

export async function pickProjectIdsForJob(args: {
  jobDescription: string;
  eligibleProjects: ResumeProjectSelectionItem[];
  desiredCount: number;
}): Promise<string[]> {
  const desiredCount = Math.max(0, Math.floor(args.desiredCount));
  if (desiredCount === 0) return [];

  const eligibleIds = new Set(args.eligibleProjects.map((p) => p.id));
  if (eligibleIds.size === 0) return [];

  const model = await resolveLlmModel("projectSelection");

  const prompt = await buildProjectSelectionPrompt({
    jobDescription: args.jobDescription,
    projects: args.eligibleProjects,
    desiredCount,
  });

  const llm = new LlmService();
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (prompt.system) {
    messages.push({ role: "system", content: prompt.system });
  }
  messages.push({ role: "user", content: prompt.user });

  const result = await llm.callJson<{ selectedProjectIds: string[] }>({
    model,
    messages,
    jsonSchema: PROJECT_SELECTION_SCHEMA,
  });

  if (!result.success) {
    return fallbackPickProjectIds(
      args.jobDescription,
      args.eligibleProjects,
      desiredCount,
    );
  }

  const selectedProjectIds = Array.isArray(result.data?.selectedProjectIds)
    ? result.data.selectedProjectIds
    : [];

  // Validate and dedupe the returned IDs
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const id of selectedProjectIds) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (!trimmed) continue;
    if (!eligibleIds.has(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
    if (unique.length >= desiredCount) break;
  }

  if (unique.length === 0) {
    return fallbackPickProjectIds(
      args.jobDescription,
      args.eligibleProjects,
      desiredCount,
    );
  }

  return unique;
}

async function buildProjectSelectionPrompt(args: {
  jobDescription: string;
  projects: ResumeProjectSelectionItem[];
  desiredCount: number;
}): Promise<{ system: string; user: string }> {
  const projects = args.projects.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    date: p.date,
    summary: truncate(p.summaryText, 500),
  }));

  const loaded = await loadPrompt("project-select", {
    jobDescription: args.jobDescription,
    projectsJson: JSON.stringify(projects, null, 2),
    desiredCount: args.desiredCount,
  });
  return { system: loaded.system, user: loaded.user };
}

function fallbackPickProjectIds(
  jobDescription: string,
  eligibleProjects: ResumeProjectSelectionItem[],
  desiredCount: number,
): string[] {
  const jd = (jobDescription || "").toLowerCase();

  const signals = [
    "react",
    "typescript",
    "javascript",
    "node",
    "next",
    "nextjs",
    "python",
    "c++",
    "c#",
    "java",
    "kotlin",
    "sql",
    "mongodb",
    "aws",
    "docker",
    "graphql",
    "php",
    "unity",
    "tailwind",
  ];

  const activeSignals = signals.filter((s) => jd.includes(s));

  const scored = eligibleProjects
    .map((p) => {
      const text = `${p.name} ${p.description} ${p.summaryText}`.toLowerCase();
      let score = 0;
      for (const signal of activeSignals) {
        if (text.includes(signal)) score += 5;
      }
      if (/\b(open source|oss)\b/.test(text)) score += 2;
      if (/\b(api|backend|frontend|full[- ]?stack)\b/.test(text)) score += 1;
      return { id: p.id, score };
    })
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, desiredCount).map((s) => s.id);
}

function truncate(input: string, maxChars: number): string {
  if (input.length <= maxChars) return input;
  return `${input.slice(0, maxChars - 1).trimEnd()}…`;
}
