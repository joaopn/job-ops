/**
 * Service for inferring job details from a pasted job description.
 */

import { AppError } from "@infra/errors";
import { logger } from "@infra/logger";
import type { ManualJobDraft } from "@shared/types";
import { JSDOM } from "jsdom";
import { LlmService } from "./llm/service";
import type { JsonSchemaDefinition } from "./llm/types";
import { resolveLlmModel } from "./modelSelection";
import { loadPrompt } from "./prompts";

export interface ManualJobInferenceResult {
  job: ManualJobDraft;
  warning?: string | null;
}

export interface FetchedJobContent {
  content: string;
  url: string;
}

/**
 * Fetch a job listing URL and return cleaned text + metadata for LLM consumption.
 *
 * Throws an AppError on network/HTTP failures; the returned `content` is the
 * concatenation of page metadata (title, og:*, description) and the main body
 * text, capped to 50k characters.
 */
export async function fetchAndExtractJobContent(
  url: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<FetchedJobContent> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    options.signal.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!response.ok) {
      throw new AppError({
        status: 502,
        code: "UPSTREAM_ERROR",
        message: `Failed to fetch URL: ${response.status} ${response.statusText}`,
      });
    }

    const html = await response.text();
    const dom = new JSDOM(html);
    const document = dom.window.document;

    const pageTitle =
      document.querySelector("title")?.textContent?.trim() || "";
    const metaDescription =
      document
        .querySelector('meta[name="description"]')
        ?.getAttribute("content")
        ?.trim() || "";
    const ogTitle =
      document
        .querySelector('meta[property="og:title"]')
        ?.getAttribute("content")
        ?.trim() || "";
    const ogDescription =
      document
        .querySelector('meta[property="og:description"]')
        ?.getAttribute("content")
        ?.trim() || "";
    const ogSiteName =
      document
        .querySelector('meta[property="og:site-name"]')
        ?.getAttribute("content")
        ?.trim() || "";

    const elementsToRemove = document.querySelectorAll(
      "script, style, nav, header, footer, aside, iframe, noscript, " +
        '[role="navigation"], [role="banner"], [role="contentinfo"], ' +
        ".nav, .navbar, .header, .footer, .sidebar, .menu, .cookie, .popup, .modal, .ad, .advertisement",
    );
    elementsToRemove.forEach((el) => {
      el.remove();
    });

    const mainContent =
      document.querySelector(
        'main, [role="main"], article, ' +
          ".job-description, .job-details, .job-content, .vacancy-description, " +
          "#job-description, #job-details, #job-content, " +
          '[class*="job-desc"], [class*="jobDesc"], [class*="vacancy"], [class*="posting"]',
      ) || document.body;

    let textContent = mainContent?.textContent || "";
    textContent = textContent
      .replace(/[\t ]+/g, " ")
      .replace(/\n\s*\n/g, "\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    let enrichedContent = "";
    if (pageTitle) enrichedContent += `Page Title: ${pageTitle}\n`;
    if (ogTitle && ogTitle !== pageTitle)
      enrichedContent += `Job Title: ${ogTitle}\n`;
    if (ogSiteName) enrichedContent += `Company/Site: ${ogSiteName}\n`;
    if (ogDescription) enrichedContent += `Summary: ${ogDescription}\n`;
    if (metaDescription && metaDescription !== ogDescription)
      enrichedContent += `Description: ${metaDescription}\n`;
    if (enrichedContent) enrichedContent += "\n---\n\n";
    enrichedContent += textContent;

    if (enrichedContent.length > 50000) {
      enrichedContent = enrichedContent.substring(0, 50000);
    }

    return { content: enrichedContent, url };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError({
        status: 408,
        code: "REQUEST_TIMEOUT",
        message: "Timed out fetching URL",
      });
    }
    throw new AppError({
      status: 502,
      code: "UPSTREAM_ERROR",
      message: error instanceof Error ? error.message : "Failed to fetch URL",
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Raw response type from the API (all fields are strings) */
interface ManualJobApiResponse {
  title: string;
  employer: string;
  location: string;
  salary: string;
  deadline: string;
  jobUrl: string;
  applicationLink: string;
  jobType: string;
  jobLevel: string;
  jobFunction: string;
  disciplines: string;
  degreeRequired: string;
  starting: string;
  jobDescription: string;
}

/** JSON schema for manual job extraction response */
const MANUAL_JOB_SCHEMA: JsonSchemaDefinition = {
  name: "manual_job_details",
  schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Job title" },
      employer: { type: "string", description: "Company/employer name" },
      location: { type: "string", description: "Job location" },
      salary: { type: "string", description: "Salary information" },
      deadline: { type: "string", description: "Application deadline" },
      jobUrl: { type: "string", description: "URL of the job listing" },
      applicationLink: {
        type: "string",
        description: "Direct application URL",
      },
      jobType: {
        type: "string",
        description: "Employment type (full-time, part-time, etc.)",
      },
      jobLevel: {
        type: "string",
        description: "Seniority level (entry, mid, senior, etc.)",
      },
      jobFunction: { type: "string", description: "Job function/category" },
      disciplines: {
        type: "string",
        description: "Required disciplines or fields",
      },
      degreeRequired: {
        type: "string",
        description: "Required degree or education",
      },
      starting: { type: "string", description: "Start date information" },
      jobDescription: {
        type: "string",
        description:
          "Clean text job description with responsibilities and requirements",
      },
    },
    required: [
      "title",
      "employer",
      "location",
      "salary",
      "deadline",
      "jobUrl",
      "applicationLink",
      "jobType",
      "jobLevel",
      "jobFunction",
      "disciplines",
      "degreeRequired",
      "starting",
      "jobDescription",
    ],
    additionalProperties: false,
  },
};

export async function inferManualJobDetails(
  jobDescription: string,
): Promise<ManualJobInferenceResult> {
  const model = await resolveLlmModel();
  const prompt = await loadPrompt("job-fetch-from-url", { jobDescription });

  const llm = new LlmService();
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (prompt.system) {
    messages.push({ role: "system", content: prompt.system });
  }
  messages.push({ role: "user", content: prompt.user });

  const result = await llm.callJson<ManualJobApiResponse>({
    model,
    messages,
    jsonSchema: MANUAL_JOB_SCHEMA,
    label: "infer job from URL",
  });

  if (!result.success) {
    if (result.error.toLowerCase().includes("api key")) {
      return {
        job: {},
        warning: "LLM API key not set. Fill details manually.",
      };
    }
    logger.warn("Manual job inference failed", { error: result.error });
    return {
      job: {},
      warning: "AI inference failed. Fill details manually.",
    };
  }

  return { job: normalizeDraft(result.data) };
}

function normalizeDraft(parsed: ManualJobApiResponse): ManualJobDraft {
  const out: ManualJobDraft = {};

  // Map each field, only including non-empty strings
  if (parsed.title?.trim()) out.title = parsed.title.trim();
  if (parsed.employer?.trim()) out.employer = parsed.employer.trim();
  if (parsed.location?.trim()) out.location = parsed.location.trim();
  if (parsed.salary?.trim()) out.salary = parsed.salary.trim();
  if (parsed.deadline?.trim()) out.deadline = parsed.deadline.trim();
  if (parsed.jobUrl?.trim()) out.jobUrl = parsed.jobUrl.trim();
  if (parsed.applicationLink?.trim())
    out.applicationLink = parsed.applicationLink.trim();
  if (parsed.jobType?.trim()) out.jobType = parsed.jobType.trim();
  if (parsed.jobLevel?.trim()) out.jobLevel = parsed.jobLevel.trim();
  if (parsed.jobFunction?.trim()) out.jobFunction = parsed.jobFunction.trim();
  if (parsed.disciplines?.trim()) out.disciplines = parsed.disciplines.trim();
  if (parsed.degreeRequired?.trim())
    out.degreeRequired = parsed.degreeRequired.trim();
  if (parsed.starting?.trim()) out.starting = parsed.starting.trim();
  if (parsed.jobDescription?.trim())
    out.jobDescription = parsed.jobDescription.trim();

  return out;
}
