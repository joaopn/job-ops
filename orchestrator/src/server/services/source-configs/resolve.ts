import type {
  SourceConfigRow,
  SourceConfigRunGlobals,
  SourceConfigSchema,
} from "@shared/types";

export function resolveSourceContextSettings(args: {
  schema: SourceConfigSchema | undefined;
  row: Pick<SourceConfigRow, "config" | "mappings">;
  runGlobals: SourceConfigRunGlobals;
}): Record<string, string> {
  const { schema, row, runGlobals } = args;
  const settings: Record<string, string> = {};

  if (schema) {
    for (const field of schema.fields) {
      if (field.default !== undefined) settings[field.key] = field.default;
    }
  }

  for (const [key, value] of Object.entries(row.config)) {
    if (typeof value === "string") settings[key] = value;
  }

  if (schema) {
    for (const mapping of schema.globalMappings) {
      const userMapped = row.mappings[mapping.globalField];
      const enabled = userMapped ?? mapping.enabledByDefault;
      if (!enabled) continue;
      const globalValue = runGlobals[mapping.globalField];
      if (globalValue === undefined) continue;
      settings[mapping.sourceField] = globalValue;
    }
  }

  return settings;
}
