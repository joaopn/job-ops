// @vitest-environment node
import type { Server } from "node:http";
import { extractCv } from "@server/services/cv/llm-extract-cv";
import type { CvContent } from "@shared/types";
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

const SAMPLE_CONTENT: CvContent = {
  basics: { name: "Ada Lovelace", profiles: [] },
  experience: [],
  education: [],
  projects: [],
  skillGroups: [],
  custom: [],
};

const SAMPLE_TEX = "\\documentclass{article}\n\\begin{document}Hi\\end{document}\n";

describe.sequential("CV API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
    vi.mocked(extractCv).mockResolvedValue({
      template: "\\documentclass{article}\n<%= e(basics.name) %>\n",
      content: SAMPLE_CONTENT,
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

  it("creates a CV from a single .tex upload", async () => {
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
      data: { id: string; name: string; content: CvContent; template: string };
    };
    expect(payload.data.name).toBe("Ada CV");
    expect(payload.data.content.basics.name).toBe("Ada Lovelace");
    expect(payload.data.template).toContain("\\documentclass");
    expect(payload.data.id).toMatch(/[0-9a-f-]+/);

    const { extractCv } = await import("@server/services/cv/llm-extract-cv");
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

  it("lists, fetches, patches, and deletes CV documents", async () => {
    const form = new FormData();
    form.append("file", new Blob([SAMPLE_TEX]), "ada.tex");
    const created = (await (
      await fetch(`${baseUrl}/api/cv`, { method: "POST", body: form })
    ).json()) as { data: { id: string } };
    const id = created.data.id;

    const list = (await (await fetch(`${baseUrl}/api/cv`)).json()) as {
      data: Array<{ id: string }>;
    };
    expect(list.data.find((entry) => entry.id === id)).toBeDefined();

    const single = (await (await fetch(`${baseUrl}/api/cv/${id}`)).json()) as {
      data: { content: CvContent };
    };
    expect(single.data.content.basics.name).toBe("Ada Lovelace");

    const updated = await fetch(`${baseUrl}/api/cv/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed CV" }),
    });
    expect(updated.status).toBe(200);
    const updatedPayload = (await updated.json()) as {
      data: { name: string };
    };
    expect(updatedPayload.data.name).toBe("Renamed CV");

    const removed = await fetch(`${baseUrl}/api/cv/${id}`, {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);

    const missing = await fetch(`${baseUrl}/api/cv/${id}`);
    expect(missing.status).toBe(404);
  });

  it("re-runs extraction on POST /api/cv/:id/re-extract", async () => {
    const form = new FormData();
    form.append("file", new Blob([SAMPLE_TEX]), "ada.tex");
    const created = (await (
      await fetch(`${baseUrl}/api/cv`, { method: "POST", body: form })
    ).json()) as { data: { id: string } };

    vi.mocked(extractCv).mockClear();
    vi.mocked(extractCv).mockResolvedValue({
      template: "\\documentclass{article}\n% re-extracted\n",
      content: { ...SAMPLE_CONTENT, summary: "Re-extracted summary." },
    });

    const res = await fetch(
      `${baseUrl}/api/cv/${created.data.id}/re-extract`,
      { method: "POST" },
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      data: { template: string; content: CvContent };
    };
    expect(payload.data.template).toContain("re-extracted");
    expect(payload.data.content.summary).toBe("Re-extracted summary.");
    expect(extractCv).toHaveBeenCalledTimes(1);
  });
});
