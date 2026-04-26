import { z } from "zod";

const promptVariableSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().default(""),
});

const modelHintsSchema = z.object({
  temperature: z.number().optional(),
  maxOutputTokens: z.number().int().optional(),
  preferStructuredOutput: z.boolean().optional(),
});

export const promptFileSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional().default(""),
    variables: z.array(promptVariableSchema).optional().default([]),
    model: modelHintsSchema.optional().default({}),
    system: z.string().optional().default(""),
    user: z.string().optional().default(""),
    template: z.string().optional().default(""),
  })
  .strict();

export type PromptFile = z.infer<typeof promptFileSchema>;
export type ModelHints = z.infer<typeof modelHintsSchema>;
