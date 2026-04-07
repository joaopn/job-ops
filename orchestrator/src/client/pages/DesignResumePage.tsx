import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import * as api from "@client/api";
import {
  ItemDialog,
  type ItemFieldConfig,
} from "@client/components/design-resume/ItemDialog";
import { RichTextEditor } from "@client/components/design-resume/RichTextEditor";
import { PageHeader, PageMain } from "@client/components/layout";
import { useDesignResume } from "@client/hooks/useDesignResume";
import type { DesignResumeDocument } from "@shared/types";
import { useQueryClient } from "@tanstack/react-query";
import {
  Download,
  FileImage,
  ImagePlus,
  Import,
  MoveDiagonal2,
  PanelLeft,
  PenSquare,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TransformComponent, TransformWrapper } from "react-zoom-pan-pinch";
import { toast } from "sonner";
import { queryKeys } from "../lib/queryKeys";

type ItemDefinition = {
  key: string;
  title: string;
  description: string;
  primaryField: string;
  secondaryField?: string;
  fields: ItemFieldConfig[];
  createItem: () => Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function getByPath(source: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, source);
}

function setByPath(
  source: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const next = structuredClone(source) as Record<string, unknown>;
  const segments = path.split(".");
  let cursor = next;
  for (const segment of segments.slice(0, -1)) {
    const current = cursor[segment];
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[segments[segments.length - 1] ?? path] = value;
  return next;
}

function fieldId(...parts: string[]): string {
  return `design-resume-${parts.join("-").replaceAll(/[^a-zA-Z0-9_-]/g, "-")}`;
}

const ITEM_DEFINITIONS: ItemDefinition[] = [
  {
    key: "profiles",
    title: "Profiles",
    description: "Links and handles shown alongside the resume basics.",
    primaryField: "network",
    secondaryField: "username",
    fields: [
      { key: "icon", label: "Icon", type: "text", placeholder: "github" },
      { key: "network", label: "Network", type: "text" },
      { key: "username", label: "Username", type: "text" },
      {
        key: "website.url",
        label: "Website",
        type: "text",
        placeholder: "https://...",
      },
      {
        key: "options.showLinkInTitle",
        label: "Show link in title",
        type: "toggle",
      },
    ],
    createItem: () => ({
      id: crypto.randomUUID(),
      hidden: false,
      icon: "",
      network: "",
      username: "",
      website: { label: "", url: "" },
      options: { showLinkInTitle: false },
    }),
  },
  {
    key: "experience",
    title: "Experience",
    description: "Roles, companies, and rich descriptions.",
    primaryField: "company",
    secondaryField: "position",
    fields: [
      { key: "company", label: "Company", type: "text" },
      { key: "location", label: "Location", type: "text" },
      { key: "position", label: "Position", type: "text" },
      { key: "period", label: "Period", type: "text" },
      {
        key: "website.url",
        label: "Website",
        type: "text",
        placeholder: "https://...",
      },
      {
        key: "options.showLinkInTitle",
        label: "Show link in title",
        type: "toggle",
      },
      { key: "description", label: "Description", type: "richtext" },
    ],
    createItem: () => ({
      id: crypto.randomUUID(),
      hidden: false,
      company: "",
      location: "",
      position: "",
      period: "",
      website: { label: "", url: "" },
      options: { showLinkInTitle: false },
      description: "",
      roles: [],
    }),
  },
  {
    key: "education",
    title: "Education",
    description: "Schooling, degrees, and achievements.",
    primaryField: "school",
    secondaryField: "degree",
    fields: [
      { key: "school", label: "School", type: "text" },
      { key: "area", label: "Area", type: "text" },
      { key: "degree", label: "Degree", type: "text" },
      { key: "grade", label: "Grade", type: "text" },
      { key: "location", label: "Location", type: "text" },
      { key: "period", label: "Period", type: "text" },
      { key: "website.url", label: "Website", type: "text" },
      {
        key: "options.showLinkInTitle",
        label: "Show link in title",
        type: "toggle",
      },
      { key: "description", label: "Description", type: "richtext" },
    ],
    createItem: () => ({
      id: crypto.randomUUID(),
      hidden: false,
      school: "",
      area: "",
      degree: "",
      grade: "",
      location: "",
      period: "",
      website: { label: "", url: "" },
      options: { showLinkInTitle: false },
      description: "",
    }),
  },
  {
    key: "projects",
    title: "Projects",
    description: "The projects JobOps will use for tailoring.",
    primaryField: "name",
    secondaryField: "period",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "period", label: "Period", type: "text" },
      { key: "website.url", label: "Website", type: "text" },
      {
        key: "options.showLinkInTitle",
        label: "Show link in title",
        type: "toggle",
      },
      { key: "description", label: "Description", type: "richtext" },
      { key: "technologies", label: "Keywords", type: "tags" },
    ],
    createItem: () => ({
      id: crypto.randomUUID(),
      hidden: false,
      name: "",
      period: "",
      website: { label: "", url: "" },
      options: { showLinkInTitle: false },
      description: "",
      technologies: [],
    }),
  },
  {
    key: "skills",
    title: "Skills",
    description: "Categories and keywords used for tailoring output.",
    primaryField: "name",
    secondaryField: "proficiency",
    fields: [
      { key: "icon", label: "Icon", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "proficiency", label: "Proficiency", type: "text" },
      { key: "level", label: "Level", type: "number", min: 0, step: 1 },
      { key: "keywords", label: "Keywords", type: "tags" },
    ],
    createItem: () => ({
      id: crypto.randomUUID(),
      hidden: false,
      icon: "",
      name: "",
      proficiency: "",
      level: 3,
      keywords: [],
    }),
  },
  {
    key: "languages",
    title: "Languages",
    description: "Spoken or written languages.",
    primaryField: "language",
    secondaryField: "fluency",
    fields: [
      { key: "language", label: "Language", type: "text" },
      { key: "fluency", label: "Fluency", type: "text" },
      { key: "level", label: "Level", type: "number", min: 0, step: 1 },
    ],
    createItem: () => ({
      id: crypto.randomUUID(),
      hidden: false,
      language: "",
      fluency: "",
      level: 3,
    }),
  },
  {
    key: "interests",
    title: "Interests",
    description: "Interests and topic clusters.",
    primaryField: "name",
    secondaryField: "icon",
    fields: [
      { key: "icon", label: "Icon", type: "text" },
      { key: "name", label: "Name", type: "text" },
      { key: "keywords", label: "Keywords", type: "tags" },
    ],
    createItem: () => ({
      id: crypto.randomUUID(),
      hidden: false,
      icon: "",
      name: "",
      keywords: [],
    }),
  },
  {
    key: "awards",
    title: "Awards",
    description: "Awards and recognitions.",
    primaryField: "title",
    secondaryField: "awarder",
    fields: [
      { key: "title", label: "Title", type: "text" },
      { key: "awarder", label: "Awarder", type: "text" },
      { key: "date", label: "Date", type: "text" },
      { key: "website.url", label: "Website", type: "text" },
      {
        key: "options.showLinkInTitle",
        label: "Show link in title",
        type: "toggle",
      },
      { key: "description", label: "Description", type: "richtext" },
    ],
    createItem: () => ({
      id: crypto.randomUUID(),
      hidden: false,
      title: "",
      awarder: "",
      date: "",
      website: { label: "", url: "" },
      options: { showLinkInTitle: false },
      description: "",
    }),
  },
  {
    key: "certifications",
    title: "Certifications",
    description: "Formal certificates and credentials.",
    primaryField: "title",
    secondaryField: "issuer",
    fields: [
      { key: "title", label: "Title", type: "text" },
      { key: "issuer", label: "Issuer", type: "text" },
      { key: "date", label: "Date", type: "text" },
      { key: "website.url", label: "Website", type: "text" },
      {
        key: "options.showLinkInTitle",
        label: "Show link in title",
        type: "toggle",
      },
      { key: "description", label: "Description", type: "richtext" },
    ],
    createItem: () => ({
      id: crypto.randomUUID(),
      hidden: false,
      title: "",
      issuer: "",
      date: "",
      website: { label: "", url: "" },
      options: { showLinkInTitle: false },
      description: "",
    }),
  },
  {
    key: "publications",
    title: "Publications",
    description: "Published writing and papers.",
    primaryField: "title",
    secondaryField: "publisher",
    fields: [
      { key: "title", label: "Title", type: "text" },
      { key: "publisher", label: "Publisher", type: "text" },
      { key: "date", label: "Date", type: "text" },
      { key: "website.url", label: "Website", type: "text" },
      {
        key: "options.showLinkInTitle",
        label: "Show link in title",
        type: "toggle",
      },
      { key: "description", label: "Description", type: "richtext" },
    ],
    createItem: () => ({
      id: crypto.randomUUID(),
      hidden: false,
      title: "",
      publisher: "",
      date: "",
      website: { label: "", url: "" },
      options: { showLinkInTitle: false },
      description: "",
    }),
  },
  {
    key: "volunteer",
    title: "Volunteer",
    description: "Volunteer work and community contributions.",
    primaryField: "organization",
    secondaryField: "position",
    fields: [
      { key: "organization", label: "Organization", type: "text" },
      { key: "location", label: "Location", type: "text" },
      { key: "period", label: "Period", type: "text" },
      { key: "position", label: "Position", type: "text" },
      { key: "website.url", label: "Website", type: "text" },
      {
        key: "options.showLinkInTitle",
        label: "Show link in title",
        type: "toggle",
      },
      { key: "description", label: "Description", type: "richtext" },
    ],
    createItem: () => ({
      id: crypto.randomUUID(),
      hidden: false,
      organization: "",
      location: "",
      period: "",
      position: "",
      website: { label: "", url: "" },
      options: { showLinkInTitle: false },
      description: "",
    }),
  },
  {
    key: "references",
    title: "References",
    description: "References and supporting contacts.",
    primaryField: "name",
    secondaryField: "position",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "position", label: "Position", type: "text" },
      { key: "phone", label: "Phone", type: "text" },
      { key: "website.url", label: "Website", type: "text" },
      {
        key: "options.showLinkInTitle",
        label: "Show link in title",
        type: "toggle",
      },
      { key: "description", label: "Description", type: "richtext" },
    ],
    createItem: () => ({
      id: crypto.randomUUID(),
      hidden: false,
      name: "",
      position: "",
      phone: "",
      website: { label: "", url: "" },
      options: { showLinkInTitle: false },
      description: "",
    }),
  },
];

function makeDownload(fileName: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

function DesignResumeRail(props: {
  draft: DesignResumeDocument;
  onUpdateResumeJson: (
    updater: (resumeJson: Record<string, unknown>) => Record<string, unknown>,
  ) => void;
  onOpenDialog: (definition: ItemDefinition, index: number | null) => void;
  onUploadPicture: () => void;
  onDeletePicture: () => void;
  pictureUploading: boolean;
}) {
  const {
    draft,
    onUpdateResumeJson,
    onOpenDialog,
    onUploadPicture,
    onDeletePicture,
    pictureUploading,
  } = props;
  const resumeJson = draft.resumeJson as Record<string, unknown>;
  const basics = (asRecord(resumeJson.basics) ?? {}) as Record<string, unknown>;
  const picture = (asRecord(resumeJson.picture) ?? {}) as Record<
    string,
    unknown
  >;
  const summary = (asRecord(resumeJson.summary) ?? {}) as Record<
    string,
    unknown
  >;
  const sections = (asRecord(resumeJson.sections) ?? {}) as Record<
    string,
    unknown
  >;
  const customFields = asArray(basics.customFields) as Record<
    string,
    unknown
  >[];

  const updateBasics = (path: string, value: unknown) => {
    onUpdateResumeJson((current) => {
      const next = structuredClone(current);
      const currentBasics = (asRecord(next.basics) ?? {}) as Record<
        string,
        unknown
      >;
      next.basics = setByPath(currentBasics, path, value);
      return next;
    });
  };

  const updatePicture = (key: string, value: unknown) => {
    onUpdateResumeJson((current) => {
      const next = structuredClone(current);
      const currentPicture = (asRecord(next.picture) ?? {}) as Record<
        string,
        unknown
      >;
      next.picture = {
        ...currentPicture,
        [key]: value,
      };
      return next;
    });
  };

  const updateSummary = (key: string, value: unknown) => {
    onUpdateResumeJson((current) => {
      const next = structuredClone(current);
      const currentSummary = (asRecord(next.summary) ?? {}) as Record<
        string,
        unknown
      >;
      next.summary = {
        ...currentSummary,
        [key]: value,
      };
      return next;
    });
  };

  const updateCustomFields = (nextFields: Record<string, unknown>[]) => {
    onUpdateResumeJson((current) => {
      const next = structuredClone(current);
      const currentBasics = (asRecord(next.basics) ?? {}) as Record<
        string,
        unknown
      >;
      next.basics = {
        ...currentBasics,
        customFields: nextFields,
      };
      return next;
    });
  };

  const moveCustomField = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= customFields.length) return;
    const nextFields = [...customFields];
    const [item] = nextFields.splice(index, 1);
    nextFields.splice(target, 0, item);
    updateCustomFields(nextFields);
  };

  const cardClassName = "rounded-xl border border-border/60 bg-card/40 p-4";
  const labelClassName =
    "text-[11px] font-medium uppercase tracking-[0.22em] text-muted-foreground";
  const fieldClassName = "bg-background/60";
  const insetPanelClassName =
    "rounded-lg border border-border/60 bg-background/60";
  const subtlePanelClassName =
    "rounded-lg border border-border/60 bg-muted/20 px-4 py-3";

  const sectionCard = (
    title: string,
    subtitle: string,
    children: React.ReactNode,
  ) => (
    <section className={cardClassName}>
      <div className='mb-3'>
        <h3 className='text-sm font-semibold text-foreground'>{title}</h3>
        <p className='text-xs leading-5 text-muted-foreground'>{subtitle}</p>
      </div>
      {children}
    </section>
  );

  return (
    <div className='space-y-4'>
      {sectionCard(
        "Picture",
        "Inline controls matching the imported resume picture block.",
        <div className='grid gap-3'>
          {picture.url ? (
            <div
              className={cn(
                "flex items-center gap-3 border-dashed p-3",
                insetPanelClassName,
              )}
            >
              <img
                src={toText(picture.url)}
                alt='Design Resume profile'
                className='h-16 w-16 rounded-lg border border-border/60 object-cover'
              />
              <div className='flex flex-wrap gap-2'>
                <Button
                  type='button'
                  variant='outline'
                  onClick={onUploadPicture}
                  disabled={pictureUploading}
                >
                  <ImagePlus className='mr-2 h-4 w-4' />
                  Replace
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  className='text-rose-400 hover:bg-rose-500/10 hover:text-rose-300'
                  onClick={onDeletePicture}
                >
                  <Trash2 className='mr-2 h-4 w-4' />
                  Delete
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type='button'
              variant='outline'
              className='justify-start border-dashed'
              onClick={onUploadPicture}
              disabled={pictureUploading}
            >
              <FileImage className='mr-2 h-4 w-4' />
              {pictureUploading ? "Uploading..." : "Upload image"}
            </Button>
          )}

          <div className='grid gap-2'>
            <label
              className={labelClassName}
              htmlFor={fieldId("picture", "url")}
            >
              Image URL
            </label>
            <Input
              id={fieldId("picture", "url")}
              value={toText(picture.url)}
              onChange={(event) =>
                updatePicture("url", event.currentTarget.value)
              }
              className={fieldClassName}
            />
          </div>

          <div
            className={cn(
              "flex items-center justify-between",
              subtlePanelClassName,
            )}
          >
            <div>
              <div className='text-sm font-medium text-foreground'>
                Show picture
              </div>
              <div className='text-xs text-muted-foreground'>
                Toggles image visibility in the stored resume.
              </div>
            </div>
            <Switch
              checked={toBoolean(picture.show, true)}
              onCheckedChange={(checked) => updatePicture("show", checked)}
            />
          </div>

          <div className='grid grid-cols-2 gap-3'>
            {[
              ["size", "Size"],
              ["rotation", "Rotation"],
              ["aspectRatio", "Aspect ratio"],
              ["borderRadius", "Border radius"],
              ["borderWidth", "Border width"],
              ["shadowWidth", "Shadow width"],
            ].map(([key, label]) => (
              <div
                key={key}
                className='grid gap-2'
              >
                <label
                  className={labelClassName}
                  htmlFor={fieldId("picture", key)}
                >
                  {label}
                </label>
                <Input
                  id={fieldId("picture", key)}
                  type='number'
                  value={String(toNumber(picture[key], 0))}
                  onChange={(event) =>
                    updatePicture(key, Number(event.currentTarget.value || 0))
                  }
                  className={fieldClassName}
                />
              </div>
            ))}
            {[
              ["borderColor", "Border color"],
              ["shadowColor", "Shadow color"],
            ].map(([key, label]) => (
              <div
                key={key}
                className='grid gap-2'
              >
                <label
                  className={labelClassName}
                  htmlFor={fieldId("picture", key)}
                >
                  {label}
                </label>
                <Input
                  id={fieldId("picture", key)}
                  value={toText(picture[key])}
                  onChange={(event) =>
                    updatePicture(key, event.currentTarget.value)
                  }
                  className={fieldClassName}
                />
              </div>
            ))}
          </div>
        </div>,
      )}

      {sectionCard(
        "Basics",
        "Core identity fields used by profile context and exports.",
        <div className='grid gap-3'>
          {[
            ["name", "Name"],
            ["headline", "Headline"],
            ["email", "Email"],
            ["phone", "Phone"],
            ["location", "Location"],
            ["website.url", "Website"],
          ].map(([path, label]) => (
            <div
              key={path}
              className='grid gap-2'
            >
              <label
                className={labelClassName}
                htmlFor={fieldId("basics", path)}
              >
                {label}
              </label>
              <Input
                id={fieldId("basics", path)}
                value={toText(getByPath(basics, path))}
                onChange={(event) =>
                  updateBasics(path, event.currentTarget.value)
                }
                className={fieldClassName}
              />
            </div>
          ))}
        </div>,
      )}

      {sectionCard(
        "Basics Custom Fields",
        "Inline badges and links shown with the main contact block.",
        <div className='space-y-3'>
          {customFields.map((field, index) => (
            <div
              key={toText(field.id, `field-${index}`)}
              className={cn("p-3", insetPanelClassName)}
            >
              <div className='grid gap-3'>
                {[
                  ["icon", "Icon"],
                  ["text", "Text"],
                  ["link", "Link"],
                ].map(([key, label]) => (
                  <div
                    key={key}
                    className='grid gap-2'
                  >
                    <label
                      className={labelClassName}
                      htmlFor={fieldId("custom-field", String(index), key)}
                    >
                      {label}
                    </label>
                    <Input
                      id={fieldId("custom-field", String(index), key)}
                      value={toText(field[key])}
                      onChange={(event) => {
                        const nextFields = [...customFields];
                        nextFields[index] = {
                          ...nextFields[index],
                          [key]: event.currentTarget.value,
                          name:
                            key === "text"
                              ? event.currentTarget.value
                              : toText(nextFields[index].name),
                          value:
                            key === "text"
                              ? event.currentTarget.value
                              : toText(nextFields[index].value),
                        };
                        updateCustomFields(nextFields);
                      }}
                      className={fieldClassName}
                    />
                  </div>
                ))}
              </div>
              <div className='mt-3 flex items-center justify-end gap-2'>
                <Button
                  type='button'
                  variant='ghost'
                  onClick={() => moveCustomField(index, -1)}
                >
                  Up
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  onClick={() => moveCustomField(index, 1)}
                >
                  Down
                </Button>
                <Button
                  type='button'
                  variant='ghost'
                  className='text-rose-400 hover:bg-rose-500/10 hover:text-rose-300'
                  onClick={() =>
                    updateCustomFields(
                      customFields.filter(
                        (_, currentIndex) => currentIndex !== index,
                      ),
                    )
                  }
                >
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <Button
            type='button'
            variant='outline'
            className='w-full border-dashed'
            onClick={() =>
              updateCustomFields([
                ...customFields,
                {
                  id: crypto.randomUUID(),
                  icon: "",
                  text: "",
                  link: "",
                  name: "",
                  value: "",
                },
              ])
            }
          >
            <Plus className='mr-2 h-4 w-4' />
            Add custom field
          </Button>
        </div>,
      )}

      {sectionCard(
        "Summary",
        "Rich text content stored as HTML.",
        <div className='space-y-3'>
          <div
            className={cn(
              "flex items-center justify-between",
              subtlePanelClassName,
            )}
          >
            <div>
              <div className='text-sm font-medium text-foreground'>
                Show summary
              </div>
              <div className='text-xs text-muted-foreground'>
                Preserves the section visibility flag from the imported resume.
              </div>
            </div>
            <Switch
              checked={!toBoolean(summary.hidden, false)}
              onCheckedChange={(checked) => updateSummary("hidden", !checked)}
            />
          </div>
          <RichTextEditor
            value={toText(summary.content)}
            onChange={(next) => updateSummary("content", next)}
            placeholder='Summarize the story your resume should tell.'
          />
        </div>,
      )}

      {ITEM_DEFINITIONS.map((definition) => {
        const section = (asRecord(sections[definition.key]) ?? {}) as Record<
          string,
          unknown
        >;
        const items = asArray(section.items).map(
          (item) => asRecord(item) ?? {},
        ) as Record<string, unknown>[];

        const updateSectionItems = (nextItems: Record<string, unknown>[]) => {
          onUpdateResumeJson((current) => {
            const next = structuredClone(current);
            const currentSections = (asRecord(next.sections) ?? {}) as Record<
              string,
              unknown
            >;
            next.sections = {
              ...currentSections,
              [definition.key]: {
                ...(asRecord(currentSections[definition.key]) ?? {}),
                items: nextItems,
              },
            };
            return next;
          });
        };

        return sectionCard(
          definition.title,
          definition.description,
          <div className='space-y-3'>
            <div
              className={cn(
                "flex items-center justify-between",
                subtlePanelClassName,
              )}
            >
              <div>
                <div className='text-sm font-medium text-foreground'>
                  {items.length} item{items.length === 1 ? "" : "s"}
                </div>
                <div className='text-xs text-muted-foreground'>
                  Edit, reorder, and hide entries for{" "}
                  {definition.title.toLowerCase()}.
                </div>
              </div>
              <Button
                type='button'
                variant='outline'
                onClick={() => onOpenDialog(definition, null)}
              >
                <Plus className='mr-2 h-4 w-4' />
                Add
              </Button>
            </div>
            {items.length === 0 ? (
              <div className='rounded-lg border border-dashed border-border/60 bg-muted/20 px-4 py-5 text-sm text-muted-foreground'>
                No items yet.
              </div>
            ) : (
              items.map((item, index) => (
                <div
                  key={toText(item.id, `${definition.key}-${index}`)}
                  className='rounded-lg border border-border/60 bg-background/60 px-4 py-3'
                >
                  <div className='flex items-start justify-between gap-3'>
                    <div>
                      <div className='text-sm font-semibold text-foreground'>
                        {toText(
                          getByPath(item, definition.primaryField),
                          "Untitled",
                        )}
                      </div>
                      {definition.secondaryField ? (
                        <div className='text-xs text-muted-foreground'>
                          {toText(getByPath(item, definition.secondaryField))}
                        </div>
                      ) : null}
                    </div>
                    <div className='rounded-full border border-border/60 px-2 py-0.5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground'>
                      {toBoolean(item.hidden, false) ? "Hidden" : "Visible"}
                    </div>
                  </div>
                  <div className='mt-3 flex flex-wrap items-center gap-2'>
                    <Button
                      type='button'
                      variant='ghost'
                      onClick={() => onOpenDialog(definition, index)}
                    >
                      Edit
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      onClick={() => {
                        const nextItems = [...items];
                        nextItems[index] = {
                          ...nextItems[index],
                          hidden: !toBoolean(nextItems[index].hidden, false),
                        };
                        updateSectionItems(nextItems);
                      }}
                    >
                      {toBoolean(item.hidden, false) ? "Show" : "Hide"}
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      onClick={() => {
                        if (index === 0) return;
                        const nextItems = [...items];
                        const [currentItem] = nextItems.splice(index, 1);
                        nextItems.splice(index - 1, 0, currentItem);
                        updateSectionItems(nextItems);
                      }}
                    >
                      Up
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      onClick={() => {
                        if (index === items.length - 1) return;
                        const nextItems = [...items];
                        const [currentItem] = nextItems.splice(index, 1);
                        nextItems.splice(index + 1, 0, currentItem);
                        updateSectionItems(nextItems);
                      }}
                    >
                      Down
                    </Button>
                    <Button
                      type='button'
                      variant='ghost'
                      className='text-rose-400 hover:bg-rose-500/10 hover:text-rose-300'
                      onClick={() =>
                        updateSectionItems(
                          items.filter(
                            (_, currentIndex) => currentIndex !== index,
                          ),
                        )
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>,
        );
      })}
    </div>
  );
}

export const DesignResumePage: React.FC = () => {
  const queryClient = useQueryClient();
  const { document, status, isLoading, error } = useDesignResume();
  const [draft, setDraft] = useState<DesignResumeDocument | null>(null);
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [dialogState, setDialogState] = useState<{
    definition: ItemDefinition;
    index: number | null;
  } | null>(null);
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [pictureUploading, setPictureUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!document) return;
    setDraft(document);
  }, [document]);

  const dirty = useMemo(() => {
    if (!draft || !document) return false;
    return (
      JSON.stringify(draft.resumeJson) !== JSON.stringify(document.resumeJson)
    );
  }, [document, draft]);

  useEffect(() => {
    if (!draft || !document || !dirty) return;
    const timer = window.setTimeout(async () => {
      try {
        setSaveState("saving");
        const updated = await api.updateDesignResume({
          baseRevision: draft.revision,
          document: draft.resumeJson,
        });
        queryClient.setQueryData(queryKeys.designResume.current(), updated);
        queryClient.setQueryData(queryKeys.designResume.status(), {
          exists: true,
          documentId: updated.id,
          updatedAt: updated.updatedAt,
        });
        setDraft(updated);
        setSaveState("saved");
      } catch (saveError) {
        setSaveState("error");
        toast.error(
          saveError instanceof Error
            ? saveError.message
            : "Failed to save Design Resume.",
        );
      }
    }, 700);

    return () => window.clearTimeout(timer);
  }, [dirty, draft, document, queryClient]);

  const setDesignResume = (next: DesignResumeDocument) => {
    queryClient.setQueryData(queryKeys.designResume.current(), next);
    queryClient.setQueryData(queryKeys.designResume.status(), {
      exists: true,
      documentId: next.id,
      updatedAt: next.updatedAt,
    });
    setDraft(next);
  };

  const updateResumeJson = (
    updater: (resumeJson: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        resumeJson: updater(current.resumeJson as Record<string, unknown>),
      };
    });
    if (saveState === "saved") setSaveState("idle");
  };

  const activeDialogItem = useMemo(() => {
    if (!dialogState || !draft) return null;
    const sections = (asRecord(draft.resumeJson.sections) ?? {}) as Record<
      string,
      unknown
    >;
    const section = (asRecord(sections[dialogState.definition.key]) ??
      {}) as Record<string, unknown>;
    const items = asArray(section.items).map(
      (item) => asRecord(item) ?? {},
    ) as Record<string, unknown>[];
    return dialogState.index == null
      ? null
      : (items[dialogState.index] ?? null);
  }, [dialogState, draft]);

  const handleImport = async () => {
    try {
      setSaveState("saving");
      const imported = await api.importDesignResumeFromRxResume();
      setDesignResume(imported);
      setSaveState("saved");
      toast.success("Imported Reactive Resume into Design Resume.");
    } catch (importError) {
      setSaveState("error");
      toast.error(
        importError instanceof Error
          ? importError.message
          : "Failed to import Reactive Resume.",
      );
    }
  };

  const handleExport = async () => {
    try {
      const exported = await api.exportDesignResume();
      makeDownload(exported.fileName, exported.document);
      toast.success("Exported Reactive Resume JSON.");
    } catch (exportError) {
      toast.error(
        exportError instanceof Error
          ? exportError.message
          : "Failed to export Design Resume.",
      );
    }
  };

  const handleUploadPicture = async (file: File) => {
    try {
      setPictureUploading(true);
      const dataUrl = await fileToDataUrl(file);
      const updated = await api.uploadDesignResumePicture({
        fileName: file.name,
        dataUrl,
      });
      setDesignResume(updated);
      toast.success("Picture uploaded.");
    } catch (uploadError) {
      toast.error(
        uploadError instanceof Error
          ? uploadError.message
          : "Failed to upload picture.",
      );
    } finally {
      setPictureUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleDeletePicture = async () => {
    try {
      const updated = await api.deleteDesignResumePicture();
      setDesignResume(updated);
      toast.success("Picture removed.");
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete picture.",
      );
    }
  };

  if (isLoading) {
    return (
      <>
        <PageHeader
          icon={PenSquare}
          title='Design Resume'
          subtitle='Loading your local resume context'
        />
        <PageMain>
          <div className='rounded-2xl border border-border/70 bg-background/95 px-6 py-20 text-center text-sm text-muted-foreground'>
            Loading Design Resume…
          </div>
        </PageMain>
      </>
    );
  }

  const rail = draft ? (
    <DesignResumeRail
      draft={draft}
      onUpdateResumeJson={updateResumeJson}
      onOpenDialog={(definition, index) =>
        setDialogState({ definition, index })
      }
      onUploadPicture={() => fileInputRef.current?.click()}
      onDeletePicture={handleDeletePicture}
      pictureUploading={pictureUploading}
    />
  ) : null;

  return (
    <>
      <input
        ref={fileInputRef}
        type='file'
        accept='image/png,image/jpeg,image/webp'
        className='hidden'
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) {
            void handleUploadPicture(file);
          }
        }}
      />
      <PageHeader
        icon={PenSquare}
        title='Design Resume'
        subtitle='Edit your resume details'
        actions={
          <div className='flex items-center gap-2'>
            <Sheet
              open={mobileRailOpen}
              onOpenChange={setMobileRailOpen}
            >
              <SheetTrigger asChild>
                <Button
                  type='button'
                  variant='outline'
                  className='lg:hidden'
                >
                  <PanelLeft className='mr-2 h-4 w-4' />
                  Edit
                </Button>
              </SheetTrigger>
              <SheetContent
                side='left'
                className='w-full max-w-[28rem] overflow-y-auto'
              >
                <SheetHeader>
                  <SheetTitle>Design Resume</SheetTitle>
                </SheetHeader>
                <div className='mt-6'>{rail}</div>
              </SheetContent>
            </Sheet>
            <Button
              type='button'
              variant='outline'
              onClick={handleImport}
            >
              <Import className='mr-2 h-4 w-4' />
              {status?.exists ? "Re-import" : "Import"}
            </Button>
            <Button
              type='button'
              variant='outline'
              onClick={handleExport}
              disabled={!status?.exists}
            >
              <Download className='mr-2 h-4 w-4' />
              Export
            </Button>
          </div>
        }
      />

      <PageMain className='h-[calc(100dvh-5rem)] overflow-hidden'>
        {!draft ? (
          <div className='flex h-full items-center justify-center rounded-2xl border border-border/70 bg-background/95 px-6 py-20 text-center'>
            <div className='mx-auto max-w-xl space-y-4'>
              <div className='inline-flex rounded-full border border-border/70 bg-muted/20 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground'>
                Resume context
              </div>
              <h2 className='text-3xl font-semibold tracking-tight text-foreground'>
                Import your current Reactive Resume once, then design locally.
              </h2>
              <p className='text-sm leading-7 text-muted-foreground'>
                JobOps will use this local Design Resume as the source of truth
                for tailoring, scoring, and project context.
              </p>
              <div className='flex justify-center gap-3'>
                <Button
                  type='button'
                  onClick={handleImport}
                >
                  <Import className='mr-2 h-4 w-4' />
                  Import from Reactive Resume
                </Button>
                {error ? (
                  <div className='rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-sm text-rose-300'>
                    {error instanceof Error
                      ? error.message
                      : "Unable to load Design Resume."}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        ) : (
          <div className='grid h-full min-h-0 gap-6 lg:grid-cols-[400px_minmax(0,1fr)] xl:grid-cols-[500px_minmax(0,1fr)]'>
            <aside className='hidden min-h-0 lg:block'>
              <div className='flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70 bg-muted/20'>
                <div className='border-b border-border/70 px-4 py-4'>
                  <div className='text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground'>
                    Design Resume
                  </div>
                  <p className='mt-1 text-xs text-muted-foreground'>
                    Edit your resume details and see a live preview on the
                    right. Changes are saved automatically.
                  </p>
                </div>
                <div className='min-h-0 flex-1 overflow-y-auto p-4'>{rail}</div>
              </div>
            </aside>
            <section className='relative flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70'>
              <div className='relative min-h-0 flex-1 overflow-hidden'>
                <TransformWrapper
                  initialScale={0.9}
                  minScale={0.6}
                  maxScale={1.8}
                  centerOnInit
                >
                  {({ zoomIn, zoomOut, resetTransform }) => (
                    <>
                      <div className='absolute right-4 top-4 z-10 flex flex-col gap-2'>
                        <Button
                          type='button'
                          variant='outline'
                          size='icon'
                          className='bg-background/90'
                          onClick={() => zoomIn()}
                        >
                          +
                        </Button>
                        <Button
                          type='button'
                          variant='outline'
                          size='icon'
                          className='bg-background/90'
                          onClick={() => zoomOut()}
                        >
                          -
                        </Button>
                        <Button
                          type='button'
                          variant='outline'
                          size='icon'
                          className='bg-background/90'
                          onClick={() => resetTransform()}
                        >
                          <RefreshCw className='h-4 w-4' />
                        </Button>
                      </div>

                      <TransformComponent
                        wrapperClass='!h-full !w-full !min-h-0'
                        contentClass='!w-full !h-full'
                      >
                        <div className='flex h-full min-h-0 items-center justify-center bg-muted/10 px-6 py-12'>
                          <div className='relative h-[980px] w-[720px] rounded-[1.75rem] border border-border/70 bg-card shadow-[0_24px_80px_rgba(0,0,0,0.24)]'>
                            <div className='absolute inset-5 grid place-items-center rounded-[1.25rem] border border-dashed border-border/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))] text-center'>
                              <div className='max-w-md space-y-4 px-10'>
                                <div className='mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-border/70 bg-background/80 text-muted-foreground'>
                                  <MoveDiagonal2 className='h-6 w-6' />
                                </div>
                                <div className='text-3xl font-semibold tracking-tight text-foreground'>
                                  Artboard reserved
                                </div>
                                <p className='text-sm leading-7 text-muted-foreground'>
                                  The central canvas already supports zooming
                                  and panning so we can drop in the renderer
                                  preview later without rebuilding the page
                                  structure.
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </TransformComponent>
                    </>
                  )}
                </TransformWrapper>
              </div>
            </section>
          </div>
        )}
      </PageMain>

      {dialogState && draft ? (
        <ItemDialog
          open={Boolean(dialogState)}
          title={`${dialogState.index == null ? "Add" : "Edit"} ${dialogState.definition.title.slice(0, -1) || dialogState.definition.title}`}
          description={dialogState.definition.description}
          item={activeDialogItem}
          fields={dialogState.definition.fields}
          onOpenChange={(open) => {
            if (!open) setDialogState(null);
          }}
          onSave={(item) => {
            updateResumeJson((current) => {
              const next = structuredClone(current);
              const sections = (asRecord(next.sections) ?? {}) as Record<
                string,
                unknown
              >;
              const section = (asRecord(sections[dialogState.definition.key]) ??
                {}) as Record<string, unknown>;
              const items = asArray(section.items).map(
                (entry) => asRecord(entry) ?? {},
              ) as Record<string, unknown>[];
              const nextItems =
                dialogState.index == null
                  ? [...items, item]
                  : items.map((entry, index) =>
                      index === dialogState.index ? item : entry,
                    );
              next.sections = {
                ...sections,
                [dialogState.definition.key]: {
                  ...section,
                  items: nextItems,
                },
              };
              return next;
            });
          }}
          onDelete={
            dialogState.index == null
              ? undefined
              : () => {
                  updateResumeJson((current) => {
                    const next = structuredClone(current);
                    const sections = (asRecord(next.sections) ?? {}) as Record<
                      string,
                      unknown
                    >;
                    const section = (asRecord(
                      sections[dialogState.definition.key],
                    ) ?? {}) as Record<string, unknown>;
                    const items = asArray(section.items).filter(
                      (_, index) => index !== dialogState.index,
                    );
                    next.sections = {
                      ...sections,
                      [dialogState.definition.key]: {
                        ...section,
                        items,
                      },
                    };
                    return next;
                  });
                  setDialogState(null);
                }
          }
        />
      ) : null}
    </>
  );
};
