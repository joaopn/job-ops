import type { APIRequestContext } from "playwright";
import { describe, expect, it, vi } from "vitest";
import {
  buildJobDetailUrl,
  extractNextData,
  fetchJobDescription,
  isExpiredDetailPage,
  readDetailDescription,
} from "../src/detail.js";

function nextDataPage(payload: unknown): string {
  return `<!DOCTYPE html><html><head><title>HiringCafe - A Job</title></head><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script></body></html>`;
}

function detailPage(description: unknown): string {
  return nextDataPage({
    props: { pageProps: { job: { job_information: { description } } } },
  });
}

/** Minimal stand-in for the browser context's APIRequestContext. */
function stubRequest(response: {
  ok?: boolean;
  body?: string;
  throws?: boolean;
}): APIRequestContext {
  const get = vi.fn(async () => {
    if (response.throws) throw new Error("network is unreachable");
    return {
      ok: () => response.ok ?? true,
      text: async () => response.body ?? "",
    };
  });
  return { get } as unknown as APIRequestContext;
}

describe("buildJobDetailUrl", () => {
  it("encodes the requisition id into the detail path", () => {
    expect(buildJobDetailUrl("9oz8s809108nzz5n")).toBe(
      "https://hiring.cafe/job/9oz8s809108nzz5n",
    );
    expect(buildJobDetailUrl("a b/c")).toBe(
      "https://hiring.cafe/job/a%20b%2Fc",
    );
  });
});

describe("extractNextData", () => {
  it("parses the __NEXT_DATA__ payload", () => {
    const parsed = extractNextData(nextDataPage({ hello: "world" }));
    expect(parsed).toEqual({ hello: "world" });
  });

  it("tolerates extra attributes on the script tag (e.g. a CSP nonce)", () => {
    const html =
      '<script id="__NEXT_DATA__" type="application/json" nonce="abc123">{"ok":true}</script>';
    expect(extractNextData(html)).toEqual({ ok: true });
  });

  it("throws when the page has no __NEXT_DATA__ script", () => {
    expect(() => extractNextData("<html><body>nope</body></html>")).toThrow(
      /no __NEXT_DATA__/,
    );
  });

  it("throws when the payload is not valid JSON", () => {
    const html =
      '<script id="__NEXT_DATA__" type="application/json">{oops</script>';
    expect(() => extractNextData(html)).toThrow(/parse failed/);
  });
});

describe("isExpiredDetailPage", () => {
  it("detects the expired-job title", () => {
    expect(isExpiredDetailPage("<title>HiringCafe - Expired Job</title>")).toBe(
      true,
    );
    expect(
      isExpiredDetailPage("<title>  hiringcafe - expired job  </title>"),
    ).toBe(true);
  });

  it("does not match a live job page", () => {
    expect(isExpiredDetailPage("<title>HiringCafe - A Job</title>")).toBe(
      false,
    );
  });
});

describe("readDetailDescription", () => {
  it("reads the description out of the detail envelope", () => {
    const parsed = extractNextData(detailPage("<h3>Description</h3>Do things"));
    expect(readDetailDescription(parsed)).toBe("<h3>Description</h3>Do things");
  });

  it("returns null when the envelope shape does not match", () => {
    expect(readDetailDescription({ props: { pageProps: {} } })).toBeNull();
    expect(readDetailDescription({ nothing: true })).toBeNull();
    expect(readDetailDescription(null)).toBeNull();
  });
});

describe("fetchJobDescription", () => {
  it("returns the description on a live detail page", async () => {
    const request = stubRequest({ body: detailPage("Real job description") });

    await expect(fetchJobDescription(request, "req-1")).resolves.toBe(
      "Real job description",
    );
    expect(request.get).toHaveBeenCalledWith(
      "https://hiring.cafe/job/req-1",
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  // Every failure below must yield null, never a throw: one bad job must not
  // take down a run.
  it("returns null on an expired posting", async () => {
    const html = `<title>HiringCafe - Expired Job</title>${detailPage("stale")}`;
    await expect(
      fetchJobDescription(stubRequest({ body: html }), "req-1"),
    ).resolves.toBeNull();
  });

  it("returns null on a non-2xx response", async () => {
    await expect(
      fetchJobDescription(stubRequest({ ok: false, body: "" }), "req-1"),
    ).resolves.toBeNull();
  });

  it("returns null when the page has no __NEXT_DATA__ (e.g. a Cloudflare interstitial)", async () => {
    await expect(
      fetchJobDescription(
        stubRequest({ body: "<html>Checking your browser…</html>" }),
        "req-1",
      ),
    ).resolves.toBeNull();
  });

  it("returns null when the description is blank or absent", async () => {
    await expect(
      fetchJobDescription(stubRequest({ body: detailPage("   ") }), "req-1"),
    ).resolves.toBeNull();
    await expect(
      fetchJobDescription(
        stubRequest({ body: detailPage(undefined) }),
        "req-1",
      ),
    ).resolves.toBeNull();
  });

  it("returns null when the request itself throws", async () => {
    await expect(
      fetchJobDescription(stubRequest({ throws: true }), "req-1"),
    ).resolves.toBeNull();
  });
});
