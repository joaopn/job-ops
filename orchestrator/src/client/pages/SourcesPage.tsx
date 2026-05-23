import * as api from "@client/api";
import { PageHeader, PageMain } from "@client/components/layout";
import { ActivityLogButton } from "@client/components/ActivityLogButton";
import { LlmStatusButton } from "@client/components/LlmStatusButton";
import { queryKeys } from "@client/lib/queryKeys";
import { toast } from "@client/lib/toast";
import type { ExtractorSourceMetadata } from "@shared/extractors";
import type {
  SourceConfigField,
  SourceConfigGlobalField,
  SourceConfigGlobalMapping,
  SourceConfigRow,
  SourceConfigSchema,
} from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Network, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const GLOBAL_FIELD_LABELS: Record<SourceConfigGlobalField, string> = {
  searchTerms: "Search terms",
  city: "City",
  workplaceTypes: "Workplace types",
  country: "Country",
  maxJobsPerTerm: "Max jobs per term (budget)",
};

export function SourcesPage() {
  const query = useQuery({
    queryKey: queryKeys.sourceConfigs.list(),
    queryFn: api.getSourceConfigs,
  });

  return (
    <>
      <PageHeader
        icon={Network}
        title="Sources"
        subtitle="Configure which job sources to run and how the Run modal's globals feed each one."
        actions={
          <>
            <LlmStatusButton />
            <ActivityLogButton />
          </>
        }
      />
      <PageMain>
        {query.isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading sources…
          </div>
        ) : null}
        {query.isError ? (
          <p className="text-sm text-destructive">
            Failed to load sources:{" "}
            {query.error instanceof Error ? query.error.message : "unknown"}
          </p>
        ) : null}
        {query.data
          ? query.data.rows
              .slice()
              .sort(
                (left, right) =>
                  (query.data.metadata[left.sourceId]?.order ?? 0) -
                  (query.data.metadata[right.sourceId]?.order ?? 0),
              )
              .map((row) => (
                <SourceCard
                  key={row.sourceId}
                  row={row}
                  metadata={query.data.metadata[row.sourceId]}
                  schema={query.data.schemas[row.sourceId]}
                />
              ))
          : null}
      </PageMain>
    </>
  );
}

interface SourceCardProps {
  row: SourceConfigRow;
  metadata: ExtractorSourceMetadata | undefined;
  schema: SourceConfigSchema | null;
}

function SourceCard({ row, metadata, schema }: SourceCardProps) {
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(row.enabled);
  const [config, setConfig] = useState<Record<string, string>>(row.config);
  const [mappings, setMappings] = useState<
    Partial<Record<SourceConfigGlobalField, boolean>>
  >(row.mappings);

  useEffect(() => {
    setEnabled(row.enabled);
    setConfig(row.config);
    setMappings(row.mappings);
  }, [row]);

  const mutation = useMutation({
    mutationFn: () =>
      api.upsertSourceConfig(row.sourceId, { enabled, config, mappings }),
    onSuccess: () => {
      toast.success(`Saved ${metadata?.label ?? row.sourceId}`);
      queryClient.invalidateQueries({
        queryKey: queryKeys.sourceConfigs.all,
      });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Save failed");
    },
  });

  const dirty =
    enabled !== row.enabled ||
    JSON.stringify(config) !== JSON.stringify(row.config) ||
    JSON.stringify(mappings) !== JSON.stringify(row.mappings);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2">
            <Checkbox
              checked={enabled}
              onCheckedChange={(value) => setEnabled(value === true)}
              aria-label={`Enable ${metadata?.label ?? row.sourceId}`}
            />
            <span>{metadata?.label ?? row.sourceId}</span>
          </CardTitle>
          {metadata?.ukOnly ? (
            <CardDescription>UK-only source.</CardDescription>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          disabled={!dirty || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="mr-1 h-3.5 w-3.5" />
          )}
          Save
        </Button>
      </CardHeader>

      <CardContent className="space-y-6">
        {schema && schema.fields.length > 0 ? (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Source-specific defaults
            </h3>
            {schema.fields.map((field) => (
              <SourceFieldInput
                key={field.key}
                field={field}
                value={config[field.key] ?? field.default ?? ""}
                onChange={(next) =>
                  setConfig((current) => ({ ...current, [field.key]: next }))
                }
              />
            ))}
          </section>
        ) : null}

        {schema && schema.globalMappings.length > 0 ? (
          <section className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Global field mappings
            </h3>
            <p className="text-xs text-muted-foreground">
              When enabled, the Run modal&apos;s value overrides this
              source&apos;s default.
            </p>
            {schema.globalMappings.map((mapping) => (
              <GlobalMappingRow
                key={mapping.globalField}
                mapping={mapping}
                checked={
                  mappings[mapping.globalField] ?? mapping.enabledByDefault
                }
                onChange={(value) =>
                  setMappings((current) => ({
                    ...current,
                    [mapping.globalField]: value,
                  }))
                }
              />
            ))}
          </section>
        ) : null}

        {!schema ? (
          <p className="text-sm text-muted-foreground">
            No configuration schema declared for this source.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

interface SourceFieldInputProps {
  field: SourceConfigField;
  value: string;
  onChange: (value: string) => void;
}

function SourceFieldInput({ field, value, onChange }: SourceFieldInputProps) {
  return (
    <div className="space-y-1">
      <Label htmlFor={`source-field-${field.key}`} className="text-sm">
        {field.label}
      </Label>
      {field.type === "textarea" ? (
        <Textarea
          id={`source-field-${field.key}`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={4}
        />
      ) : (
        <Input
          id={`source-field-${field.key}`}
          type={
            field.type === "number"
              ? "number"
              : field.type === "secret"
                ? "password"
                : "text"
          }
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {field.description ? (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      ) : null}
    </div>
  );
}

interface GlobalMappingRowProps {
  mapping: SourceConfigGlobalMapping;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function GlobalMappingRow({
  mapping,
  checked,
  onChange,
}: GlobalMappingRowProps) {
  return (
    <label className="flex items-start gap-3 rounded-md border border-border/60 p-2 text-sm">
      <Checkbox
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <span className="space-y-0.5">
        <span className="block font-medium">
          {GLOBAL_FIELD_LABELS[mapping.globalField]} →{" "}
          <code className="text-xs">{mapping.sourceField}</code>
        </span>
        {mapping.description ? (
          <span className="block text-xs text-muted-foreground">
            {mapping.description}
          </span>
        ) : null}
      </span>
    </label>
  );
}
