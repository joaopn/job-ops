/**
 * Stub prompt-template helpers. Phase 1.5 replaces this with YAML loading
 * from a bind-mounted prompts/ directory. Until then, a minimal Mustache-style
 * `{{var}}` interpolator and inline defaults keep the LLM-driven services
 * (scorer, ghostwriter, summary) booting.
 */

const DEFAULT_SCORING_PROMPT = `Rate how well this candidate fits the job on a 0-100 scale.

Profile:
{{profileJson}}

Job:
- Title: {{jobTitle}}
- Employer: {{employer}}
- Location: {{location}}
- Salary: {{salary}}
- Degree required: {{degreeRequired}}
- Disciplines: {{disciplines}}

Job description:
{{jobDescription}}

Additional scoring guidance: {{scoringInstructionsText}}

Respond as JSON with { "score": <0-100 integer>, "reason": "<one to two sentence explanation>" }.`;

const DEFAULT_GHOSTWRITER_SYSTEM_PROMPT = `You are a careful resume ghostwriter. Help the user revise their CV bullets and cover-letter copy for a specific job. Suggest small, concrete edits. Avoid fabricating experience.`;

const DEFAULT_TAILORING_PROMPT = `Adjust the candidate's resume content to better match the job below. Keep facts grounded in the original profile. Return only the JSON content the system asks for.

Profile:
{{profileJson}}

Job:
{{jobDescription}}`;

export type DefaultPromptKey =
  | "scoringPromptTemplate"
  | "ghostwriterSystemPromptTemplate"
  | "tailoringPromptTemplate";

const DEFAULTS: Record<DefaultPromptKey, string> = {
  scoringPromptTemplate: DEFAULT_SCORING_PROMPT,
  ghostwriterSystemPromptTemplate: DEFAULT_GHOSTWRITER_SYSTEM_PROMPT,
  tailoringPromptTemplate: DEFAULT_TAILORING_PROMPT,
};

export function getDefaultPromptTemplate(key: DefaultPromptKey): string {
  return DEFAULTS[key];
}

/**
 * Returns the prompt template that should actually be used at call time. The
 * stored-override layer is gone (those settings keys were dropped from the
 * registry); Phase 1.5 reintroduces overrides via YAML on disk. For now this
 * always returns the inline default.
 */
export async function getEffectivePromptTemplate(
  key: DefaultPromptKey,
): Promise<string> {
  return getDefaultPromptTemplate(key);
}

export function renderPromptTemplate(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, name) => {
    const value = vars[name as string];
    if (value === null || value === undefined) return "";
    return String(value);
  });
}
