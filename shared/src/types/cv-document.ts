import type { CvContent } from "./cv-content";

export interface CvDocument {
  id: string;
  name: string;
  flattenedTex: string;
  template: string;
  content: CvContent;
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
  template: string;
  content: CvContent;
}

export interface UpdateCvDocumentInput {
  name?: string;
  originalArchive?: Uint8Array;
  flattenedTex?: string;
  template?: string;
  content?: CvContent;
}
