import type { CvField } from "./cv-content";

export interface CvDocument {
  id: string;
  name: string;
  flattenedTex: string;
  fields: CvField[];
  personalBrief: string;
  createdAt: string;
  updatedAt: string;
}

export interface CvDocumentSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCvDocumentInput {
  name: string;
  originalArchive: Uint8Array;
  flattenedTex: string;
  fields: CvField[];
  personalBrief: string;
}

export interface UpdateCvDocumentInput {
  name?: string;
  originalArchive?: Uint8Array;
  flattenedTex?: string;
  fields?: CvField[];
  personalBrief?: string;
}
