import type { StepId, ValidationState } from "./types";

export const EMPTY_VALIDATION_STATE: ValidationState = {
  valid: false,
  message: null,
  checked: false,
  hydrated: false,
};

export const STEP_COPY: Record<
  StepId,
  {
    eyebrow: string;
    title: string;
    description: string;
  }
> = {
  llm: {
    eyebrow: "Step 1",
    title: "Choose the LLM connection Job Ops should use.",
    description:
      "Pick the provider, confirm the endpoint, and validate the credentials this workspace will use for scoring and tailoring.",
  },
  cv: {
    eyebrow: "Step 2",
    title: "Upload your CV.",
    description:
      "Drop your LaTeX CV — the server flattens, compiles, and extracts it. The personal brief drafted from your CV is what powers per-job tailoring; you can paste in extra context (side projects, tools you've used in passing) before continuing.",
  },
  searchterms: {
    eyebrow: "Step 3",
    title: "Choose the job titles to search for.",
    description:
      "Edit the list so Job Ops searches for the roles you actually want next.",
  },
  basicauth: {
    eyebrow: "Step 4",
    title: "Secure your workspace",
    description:
      "Add a username and password so only signed-in users can access protected parts of Job Ops. You can always set this up later in Settings.",
  },
};
