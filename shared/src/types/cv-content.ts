/**
 * CvContent is the opaque, free-form JSON object the LLM extracts from a
 * source CV. The shape mirrors whatever sections the source CV uses — there
 * is intentionally no project-imposed schema. Per-job tailoring reads the
 * personal brief, not this object; CvContent is the render target only.
 */
export type CvContent = Record<string, unknown>;
