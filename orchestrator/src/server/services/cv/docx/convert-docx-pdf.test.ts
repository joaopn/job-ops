// @vitest-environment node
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import {
  convertDocxToPdf,
  getUnoserverPid,
  stopUnoserver,
} from "./convert-docx-pdf";
import { simpleDoc } from "./test/fixture-builder";

const execFileAsync = promisify(execFile);

// The first conversion pays the daemon spawn plus the readiness-probe loop
// (5–15s observed in W1, 30s grace ceiling); later conversions ride the
// warm daemon.
const COLD_TEST_TIMEOUT_MS = 120_000;
const WARM_TEST_TIMEOUT_MS = 60_000;

async function pdfToText(pdf: Uint8Array): Promise<string> {
  const dir = await fs.mkdtemp(path.join(tmpdir(), "convert-docx-pdf-test-"));
  try {
    const pdfPath = path.join(dir, "out.pdf");
    await fs.writeFile(pdfPath, pdf);
    const { stdout } = await execFileAsync("pdftotext", [pdfPath, "-"]);
    return stdout;
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function pdfMagic(pdf: Uint8Array): string {
  return Buffer.from(pdf.subarray(0, 5)).toString("ascii");
}

describe("convertDocxToPdf", () => {
  afterAll(async () => {
    await stopUnoserver();
  });

  // Runs FIRST, while the module singleton is still cold — a warm daemon
  // would never re-read UNOSERVER_BIN.
  it("fails UNAVAILABLE when the unoserver binary is missing", async () => {
    process.env.UNOSERVER_BIN = "/nonexistent/unoserver";
    try {
      await expect(
        convertDocxToPdf({ docx: simpleDoc() }),
      ).rejects.toMatchObject({
        name: "ConvertDocxError",
        code: "UNAVAILABLE",
      });
    } finally {
      delete process.env.UNOSERVER_BIN;
    }
  });

  it(
    "converts a docx to a PDF containing the fixture text",
    async () => {
      const pdf = await convertDocxToPdf({ docx: simpleDoc() });
      expect(pdfMagic(pdf)).toBe("%PDF-");
      const text = await pdfToText(pdf);
      expect(text).toContain("Jane Q. Applicant");
      expect(text).toContain("queue-based architecture");
    },
    COLD_TEST_TIMEOUT_MS,
  );

  it(
    "reuses the warm daemon for subsequent conversions (stable PID)",
    async () => {
      const pidBefore = getUnoserverPid();
      expect(pidBefore).not.toBeNull();
      const pdf = await convertDocxToPdf({ docx: simpleDoc() });
      expect(pdfMagic(pdf)).toBe("%PDF-");
      expect(getUnoserverPid()).toBe(pidBefore);
    },
    WARM_TEST_TIMEOUT_MS,
  );
});
