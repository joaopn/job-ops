/**
 * Repository for cv_documents — the user-uploaded LaTeX CVs and their
 * extracted Eta template + structured CvContent.
 */

import { randomUUID } from "node:crypto";
import type {
  CreateCvDocumentInput,
  CvContent,
  CvDocument,
  CvDocumentSummary,
  UpdateCvDocumentInput,
} from "@shared/types";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "../db/index";

const { cvDocuments } = schema;

function mapRow(row: typeof cvDocuments.$inferSelect): CvDocument {
  return {
    id: row.id,
    name: row.name,
    flattenedTex: row.flattenedTex,
    template: row.template,
    content: row.content as CvContent,
    personalBrief: row.personalBrief ?? "",
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function mapRowToSummary(
  row: Pick<
    typeof cvDocuments.$inferSelect,
    "id" | "name" | "createdAt" | "updatedAt"
  >,
): CvDocumentSummary {
  return {
    id: row.id,
    name: row.name,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export async function listCvDocuments(): Promise<CvDocumentSummary[]> {
  const rows = await db
    .select({
      id: cvDocuments.id,
      name: cvDocuments.name,
      createdAt: cvDocuments.createdAt,
      updatedAt: cvDocuments.updatedAt,
    })
    .from(cvDocuments)
    .orderBy(desc(cvDocuments.updatedAt));
  return rows.map(mapRowToSummary);
}

export async function getCvDocumentById(
  id: string,
): Promise<CvDocument | null> {
  const [row] = await db
    .select()
    .from(cvDocuments)
    .where(eq(cvDocuments.id, id));
  return row ? mapRow(row) : null;
}

export async function getCvDocumentArchive(
  id: string,
): Promise<Buffer | null> {
  const [row] = await db
    .select({ originalArchive: cvDocuments.originalArchive })
    .from(cvDocuments)
    .where(eq(cvDocuments.id, id));
  return row ? (row.originalArchive as Buffer) : null;
}

export async function createCvDocument(
  input: CreateCvDocumentInput,
): Promise<CvDocument> {
  const id = randomUUID();
  const now = Date.now();

  await db.insert(cvDocuments).values({
    id,
    name: input.name,
    originalArchive: Buffer.from(input.originalArchive),
    flattenedTex: input.flattenedTex,
    template: input.template,
    content: input.content,
    personalBrief: input.personalBrief ?? "",
    createdAt: now,
    updatedAt: now,
  });

  const created = await getCvDocumentById(id);
  if (!created) {
    throw new Error(`Failed to load created cv document ${id}.`);
  }
  return created;
}

export async function updateCvDocument(
  id: string,
  input: UpdateCvDocumentInput,
): Promise<CvDocument | null> {
  const now = Date.now();

  await db
    .update(cvDocuments)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.originalArchive !== undefined
        ? { originalArchive: Buffer.from(input.originalArchive) }
        : {}),
      ...(input.flattenedTex !== undefined
        ? { flattenedTex: input.flattenedTex }
        : {}),
      ...(input.template !== undefined ? { template: input.template } : {}),
      ...(input.content !== undefined ? { content: input.content } : {}),
      ...(input.personalBrief !== undefined
        ? { personalBrief: input.personalBrief }
        : {}),
      updatedAt: now,
    })
    .where(eq(cvDocuments.id, id));

  return getCvDocumentById(id);
}

export async function deleteCvDocument(id: string): Promise<number> {
  const result = await db
    .delete(cvDocuments)
    .where(eq(cvDocuments.id, id))
    .run();
  return result.changes;
}
