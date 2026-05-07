/**
 * Repository for cover_letter_documents — the user-uploaded LaTeX cover
 * letters and their extracted CvField list. Mirror of cv-documents.ts.
 */

import { randomUUID } from "node:crypto";
import type {
  CoverLetterDocument,
  CoverLetterDocumentSummary,
  CreateCoverLetterDocumentInput,
  CvField,
  CvFieldOverrides,
  UpdateCoverLetterDocumentInput,
} from "@shared/types";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "../db/index";

const { coverLetterDocuments } = schema;

function mapRow(
  row: typeof coverLetterDocuments.$inferSelect,
): CoverLetterDocument {
  return {
    id: row.id,
    name: row.name,
    flattenedTex: row.flattenedTex,
    fields: parseFields(row.fields),
    templatedTex: row.templatedTex ?? "",
    defaultFieldValues: parseDefaultFieldValues(row.defaultFieldValues),
    lastCompileStderr: row.lastCompileStderr ?? null,
    compileAttempts: row.compileAttempts ?? 0,
    extractionPrompt: row.extractionPrompt ?? "",
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function parseFields(raw: unknown): CvField[] {
  if (Array.isArray(raw)) return raw as CvField[];
  return [];
}

function parseDefaultFieldValues(raw: unknown): CvFieldOverrides {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: CvFieldOverrides = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function mapRowToSummary(
  row: Pick<
    typeof coverLetterDocuments.$inferSelect,
    "id" | "name" | "createdAt" | "updatedAt"
  >,
): CoverLetterDocumentSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export async function listCoverLetterDocuments(): Promise<CoverLetterDocumentSummary[]> {
  const rows = await db
    .select({
      id: coverLetterDocuments.id,
      name: coverLetterDocuments.name,
      createdAt: coverLetterDocuments.createdAt,
      updatedAt: coverLetterDocuments.updatedAt,
    })
    .from(coverLetterDocuments)
    .orderBy(desc(coverLetterDocuments.updatedAt));
  return rows.map(mapRowToSummary);
}

export async function getCoverLetterDocumentById(
  id: string,
): Promise<CoverLetterDocument | null> {
  const [row] = await db
    .select()
    .from(coverLetterDocuments)
    .where(eq(coverLetterDocuments.id, id));
  return row ? mapRow(row) : null;
}

export async function getCoverLetterDocumentArchive(
  id: string,
): Promise<Buffer | null> {
  const [row] = await db
    .select({ originalArchive: coverLetterDocuments.originalArchive })
    .from(coverLetterDocuments)
    .where(eq(coverLetterDocuments.id, id));
  return row ? (row.originalArchive as Buffer) : null;
}

export async function createCoverLetterDocument(
  input: CreateCoverLetterDocumentInput,
): Promise<CoverLetterDocument> {
  const id = randomUUID();
  const now = Date.now();

  await db.insert(coverLetterDocuments).values({
    id,
    name: input.name,
    originalArchive: Buffer.from(input.originalArchive),
    flattenedTex: input.flattenedTex,
    fields: input.fields,
    templatedTex: input.templatedTex ?? "",
    defaultFieldValues: input.defaultFieldValues ?? {},
    lastCompileStderr: input.lastCompileStderr ?? null,
    compileAttempts: input.compileAttempts ?? 0,
    extractionPrompt: input.extractionPrompt ?? "",
    createdAt: now,
    updatedAt: now,
  });

  const created = await getCoverLetterDocumentById(id);
  if (!created) {
    throw new Error(`Failed to load created cover-letter document ${id}.`);
  }
  return created;
}

export async function updateCoverLetterDocument(
  id: string,
  input: UpdateCoverLetterDocumentInput,
): Promise<CoverLetterDocument | null> {
  const now = Date.now();

  await db
    .update(coverLetterDocuments)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.originalArchive !== undefined
        ? { originalArchive: Buffer.from(input.originalArchive) }
        : {}),
      ...(input.flattenedTex !== undefined
        ? { flattenedTex: input.flattenedTex }
        : {}),
      ...(input.fields !== undefined ? { fields: input.fields } : {}),
      ...(input.templatedTex !== undefined
        ? { templatedTex: input.templatedTex }
        : {}),
      ...(input.defaultFieldValues !== undefined
        ? { defaultFieldValues: input.defaultFieldValues }
        : {}),
      ...(input.lastCompileStderr !== undefined
        ? { lastCompileStderr: input.lastCompileStderr }
        : {}),
      ...(input.compileAttempts !== undefined
        ? { compileAttempts: input.compileAttempts }
        : {}),
      ...(input.extractionPrompt !== undefined
        ? { extractionPrompt: input.extractionPrompt }
        : {}),
      updatedAt: now,
    })
    .where(eq(coverLetterDocuments.id, id));

  return getCoverLetterDocumentById(id);
}

export async function deleteCoverLetterDocument(id: string): Promise<number> {
  const result = await db
    .delete(coverLetterDocuments)
    .where(eq(coverLetterDocuments.id, id))
    .run();
  return result.changes;
}
