// @vitest-environment node
import type { Server } from "node:http";
import { extractCv } from "@server/services/cv/llm-extract-cv";
import type { CvField } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

vi.mock("@server/services/cv/llm-extract-cv", () => ({
  extractCv: vi.fn(),
  CvExtractError: class extends Error {
    readonly code: string;
    constructor(message: string, code: string) {
      super(message);
      this.code = code;
    }
  },
}));

const SAMPLE_FIELDS: CvField[] = [
  { id: "basics.name", role: "name", value: "Ada Lovelace" },
];

const SAMPLE_BRIEF = "I'm Ada — I write algorithms.";

const SAMPLE_TEX =
  "\\documentclass{article}\n\\begin{document}\nAda Lovelace\n\\end{document}\n";

describe.sequential("CV API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
    vi.mocked(extractCv).mockResolvedValue({
      fields: SAMPLE_FIELDS,
      personalBrief: SAMPLE_BRIEF,
    });
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("rejects POST /api/cv with no file", async () => {
    const form = new FormData();
    form.append("name", "no-file");
    const res = await fetch(`${baseUrl}/api/cv`, {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(400);
  });

  it("uploads a .tex file and persists the extracted fields", async () => {
    const form = new FormData();
    form.append("name", "Ada CV");
    form.append(
      "file",
      new Blob([SAMPLE_TEX], { type: "application/x-tex" }),
      "ada.tex",
    );

    const res = await fetch(`${baseUrl}/api/cv`, {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(201);
    const payload = (await res.json()) as {
      data: {
        id: string;
        name: string;
        fields: CvField[];
        personalBrief: string;
      };
    };
    expect(payload.data.name).toBe("Ada CV");
    expect(payload.data.fields).toEqual(SAMPLE_FIELDS);
    expect(payload.data.personalBrief).toBe(SAMPLE_BRIEF);
    expect(payload.data.id).toMatch(/[0-9a-f-]+/);

    expect(extractCv).toHaveBeenCalledWith(
      expect.objectContaining({
        flattenedTex: SAMPLE_TEX,
        assetReferences: [],
      }),
    );
  });

  it("rejects single .tex with unresolved \\input directives", async () => {
    const tex = "\\documentclass{article}\n\\input{header}\n";
    const form = new FormData();
    form.append("file", new Blob([tex]), "broken.tex");
    const res = await fetch(`${baseUrl}/api/cv`, {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: { code: string } };
    expect(payload.error.code).toBe("INVALID_REQUEST");
  });

  it("round-trips name and personal-brief edits via PATCH", async () => {
    const form = new FormData();
    form.append("file", new Blob([SAMPLE_TEX]), "ada.tex");
    const created = (await (
      await fetch(`${baseUrl}/api/cv`, { method: "POST", body: form })
    ).json()) as { data: { id: string } };
    const id = created.data.id;

    const updated = await fetch(`${baseUrl}/api/cv/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Renamed CV",
        personalBrief: "I now have postgres experience.",
      }),
    });
    expect(updated.status).toBe(200);
    const payload = (await updated.json()) as {
      data: {
        name: string;
        personalBrief: string;
        fields: CvField[];
      };
    };
    expect(payload.data.name).toBe("Renamed CV");
    expect(payload.data.personalBrief).toBe("I now have postgres experience.");
    expect(payload.data.fields).toEqual(SAMPLE_FIELDS);

    const removed = await fetch(`${baseUrl}/api/cv/${id}`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);

    const missing = await fetch(`${baseUrl}/api/cv/${id}`);
    expect(missing.status).toBe(404);
  });

  it("rejects PATCH with 422 when personalBrief exceeds maxBriefChars", async () => {
    const form = new FormData();
    form.append("file", new Blob([SAMPLE_TEX]), "ada.tex");
    const created = (await (
      await fetch(`${baseUrl}/api/cv`, { method: "POST", body: form })
    ).json()) as { data: { id: string } };
    const id = created.data.id;

    // Default maxBriefChars is 200_000; send 200_001 to exceed it.
    const oversized = "x".repeat(200_001);
    const res = await fetch(`${baseUrl}/api/cv/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personalBrief: oversized }),
    });
    expect(res.status).toBe(422);
    const payload = (await res.json()) as {
      error: {
        code: string;
        message: string;
        details: { field: string; observed: number; max: number };
      };
    };
    expect(payload.error.code).toBe("UNPROCESSABLE_ENTITY");
    expect(payload.error.details.field).toBe("personalBrief");
    expect(payload.error.details.observed).toBe(200_001);
    expect(payload.error.details.max).toBe(200_000);
  });

  it("rejects PATCH with 422 when extractionPrompt exceeds maxExtractionPromptChars", async () => {
    const form = new FormData();
    form.append("file", new Blob([SAMPLE_TEX]), "ada.tex");
    const created = (await (
      await fetch(`${baseUrl}/api/cv`, { method: "POST", body: form })
    ).json()) as { data: { id: string } };
    const id = created.data.id;

    const oversized = "x".repeat(100_001);
    const res = await fetch(`${baseUrl}/api/cv/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extractionPrompt: oversized }),
    });
    expect(res.status).toBe(422);
    const payload = (await res.json()) as {
      error: {
        code: string;
        details: { field: string; observed: number; max: number };
      };
    };
    expect(payload.error.code).toBe("UNPROCESSABLE_ENTITY");
    expect(payload.error.details.field).toBe("extractionPrompt");
    expect(payload.error.details.max).toBe(100_000);
  });

  it("accepts PATCH with personalBrief at the maxBriefChars boundary", async () => {
    const form = new FormData();
    form.append("file", new Blob([SAMPLE_TEX]), "ada.tex");
    const created = (await (
      await fetch(`${baseUrl}/api/cv`, { method: "POST", body: form })
    ).json()) as { data: { id: string } };
    const id = created.data.id;

    // Length of EXACTLY 200_000 should pass.
    const atCap = "x".repeat(200_000);
    const res = await fetch(`${baseUrl}/api/cv/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ personalBrief: atCap }),
    });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      data: { personalBrief: string };
    };
    expect(payload.data.personalBrief.length).toBe(200_000);
  });

  it("re-runs extraction on POST /api/cv/:id/re-extract and updates the brief", async () => {
    const form = new FormData();
    form.append("file", new Blob([SAMPLE_TEX]), "ada.tex");
    const created = (await (
      await fetch(`${baseUrl}/api/cv`, { method: "POST", body: form })
    ).json()) as { data: { id: string } };

    vi.mocked(extractCv).mockClear();
    const refreshedFields: CvField[] = [
      ...SAMPLE_FIELDS,
      { id: "summary.0", role: "summary", value: "Re-extracted summary." },
    ];
    vi.mocked(extractCv).mockResolvedValue({
      fields: refreshedFields,
      personalBrief: "Updated brief.",
    });

    const res = await fetch(`${baseUrl}/api/cv/${created.data.id}/re-extract`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      data: {
        fields: CvField[];
        personalBrief: string;
      };
    };
    expect(payload.data.fields).toEqual(refreshedFields);
    expect(payload.data.personalBrief).toBe("Updated brief.");
    expect(extractCv).toHaveBeenCalledTimes(1);
  });
});
