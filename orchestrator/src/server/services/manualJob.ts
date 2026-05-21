/**
 * Service for inferring job details from a pasted job description.
 */

import { AppError, unprocessableEntity } from "@infra/errors";
import { logger } from "@infra/logger";
import type { ManualJobDraft } from "@shared/types";
import { JSDOM } from "jsdom";
import { type Browser, firefox } from "playwright";
import { LlmService } from "./llm/service";
import type { JsonSchemaDefinition } from "./llm/types";
import { resolveLlmModel } from "./modelSelection";
import { loadPrompt } from "./prompts";
import { getEffectiveSettings } from "./settings";

export interface ManualJobInferenceResult {
  job: ManualJobDraft;
  warning?: string | null;
}

export interface FetchedJobContent {
  content: string;
  url: string;
}

const BROWSER_FETCH_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Lazy Camoufox singleton — Camoufox is a Firefox fork with anti-fingerprinting
// patches; vanilla Playwright Firefox is rejected by some hosts. camoufox-js
// is imported dynamically because its top-level FingerprintGenerator reads a
// large Bayesian-network JSON at module load, which breaks vitest test
// suites that transitively import this file.
let _browserPromise: Promise<Browser> | null = null;
function getBrowser(): Promise<Browser> {
  if (!_browserPromise) {
    _browserPromise = (async () => {
      const { launchOptions } = await import("camoufox-js");
      const options = await launchOptions({
        headless: true,
        humanize: true,
        geoip: true,
      });
      return firefox.launch(options);
    })().catch((err) => {
      _browserPromise = null;
      throw err;
    });
  }
  return _browserPromise;
}

async function tryStaticFetch(
  url: string,
  signal: AbortSignal,
): Promise<{ html: string; finalUrl: string } | null> {
  // Many ATS / job-board hosts (SAP SuccessFactors, etc.) return 204 to
  // requests with no Referer as basic anti-scraping. Synthesize a same-origin
  // Referer so the request looks like internal navigation.
  const origin = new URL(url).origin;
  const response = await fetch(url, {
    signal,
    headers: {
      "User-Agent": BROWSER_FETCH_UA,
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      Referer: `${origin}/`,
    },
  });

  if (!response.ok) {
    if (response.status === 204) return null;
    throw new AppError({
      status: 502,
      code: "UPSTREAM_ERROR",
      message: `Failed to fetch URL: ${response.status} ${response.statusText}`,
    });
  }

  const html = await response.text();
  if (!html.trim()) return null;
  return { html, finalUrl: response.url };
}

async function tryBrowserFetch(
  url: string,
  timeoutMs: number,
  settleMs: number,
): Promise<{ html: string; finalUrl: string }> {
  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (err) {
    throw new AppError({
      status: 502,
      code: "UPSTREAM_ERROR",
      message:
        err instanceof Error
          ? `Browser fallback failed to launch: ${err.message}`
          : "Browser fallback failed to launch",
      details: {
        hint: "Browser-rendered fallback failed to start; static fetch returned empty body.",
      },
    });
  }

  // Camoufox sets its own UA/locale/timezone; don't pass userAgent here.
  const context = await browser.newContext({
    javaScriptEnabled: true,
    acceptDownloads: false,
    serviceWorkers: "block",
  });
  try {
    const page = await context.newPage();
    page.on("dialog", (d) => {
      d.dismiss().catch(() => {});
    });
    page.on("popup", (p) => {
      p.close().catch(() => {});
    });
    await context.route("**/*", (route) => {
      // Only abort images and media; fonts often gate SPA bootstrap
      // (Angular/React apps that await document.fonts.ready).
      const t = route.request().resourceType();
      if (t === "image" || t === "media") {
        return route.abort();
      }
      return route.continue();
    });
    // Same Referer trick as tier-1 — covers ATS hosts that gate on Referer
    // presence (TU Wien / SAP SuccessFactors return 204 to direct hits).
    const origin = new URL(url).origin;
    try {
      await page.goto(url, {
        waitUntil: "load",
        timeout: timeoutMs,
        referer: `${origin}/`,
      });
    } catch (err) {
      // NS_BINDING_ABORTED fires when SPAs trigger an immediate JS redirect
      // before the initial navigation finishes. The page typically still
      // renders; proceed to read content if we got past the initial response.
      const message = err instanceof Error ? err.message : "";
      if (!message.includes("NS_BINDING_ABORTED")) {
        throw err;
      }
    }
    if (settleMs > 0) {
      // Wait up to settleMs for the page's network to go idle (SPA hydration);
      // returns sooner if the network settles. 0 reads the DOM immediately.
      await page
        .waitForLoadState("networkidle", { timeout: settleMs })
        .catch(() => {});
    }
    return { html: await page.content(), finalUrl: page.url() };
  } finally {
    await context.close().catch(() => {});
  }
}

function extractFromHtml(html: string, finalUrl: string): FetchedJobContent {
  const dom = new JSDOM(html);
  const document = dom.window.document;

  const pageTitle = document.querySelector("title")?.textContent?.trim() || "";
  const metaDescription =
    document
      .querySelector('meta[name="description"]')
      ?.getAttribute("content")
      ?.trim() || "";
  const ogTitle =
    document
      .querySelector('meta[property="og:title"]')
      ?.getAttribute("content")
      ?.trim() || "";
  const ogDescription =
    document
      .querySelector('meta[property="og:description"]')
      ?.getAttribute("content")
      ?.trim() || "";
  const ogSiteName =
    document
      .querySelector('meta[property="og:site-name"]')
      ?.getAttribute("content")
      ?.trim() || "";

  const elementsToRemove = document.querySelectorAll(
    "script, style, nav, header, footer, aside, iframe, noscript, " +
      '[role="navigation"], [role="banner"], [role="contentinfo"], ' +
      ".nav, .navbar, .header, .footer, .sidebar, .menu, .cookie, .popup, .modal, .ad, .advertisement",
  );
  elementsToRemove.forEach((el) => {
    el.remove();
  });

  const mainContent =
    document.querySelector(
      'main, [role="main"], article, ' +
        ".job-description, .job-details, .job-content, .vacancy-description, " +
        "#job-description, #job-details, #job-content, " +
        '[class*="job-desc"], [class*="jobDesc"], [class*="vacancy"], [class*="posting"]',
    ) || document.body;

  let textContent = mainContent?.textContent || "";
  textContent = textContent
    .replace(/[\t ]+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  let enrichedContent = "";
  if (pageTitle) enrichedContent += `Page Title: ${pageTitle}\n`;
  if (ogTitle && ogTitle !== pageTitle)
    enrichedContent += `Job Title: ${ogTitle}\n`;
  if (ogSiteName) enrichedContent += `Company/Site: ${ogSiteName}\n`;
  if (ogDescription) enrichedContent += `Summary: ${ogDescription}\n`;
  if (metaDescription && metaDescription !== ogDescription)
    enrichedContent += `Description: ${metaDescription}\n`;
  if (enrichedContent) enrichedContent += "\n---\n\n";
  enrichedContent += textContent;

  return { content: enrichedContent, url: finalUrl };
}

/**
 * Fetch a job listing URL and return cleaned text + metadata for LLM consumption.
 *
 * Two-tier strategy: static `fetch` first; if it returns empty body / 204, or
 * the JSDOM-extracted text falls below the user-configured minimum, fall
 * through to an in-process Playwright/Firefox render. Throws 408 on outer
 * timeout, 502 on upstream HTTP failures, 422 if the final extracted content
 * exceeds `settings.maxFetchedJobHtmlChars`.
 */
export async function fetchAndExtractJobContent(
  url: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<FetchedJobContent> {
  const settings = await getEffectiveSettings();
  const timeoutMs =
    options.timeoutMs ?? settings.manualJobFetchTimeoutMs.value;
  const minExtracted = settings.manualJobFetchMinExtractedChars.value;
  const settleMs = settings.manualJobFetchBrowserSettleMs.value;
  const sizeCap = settings.maxFetchedJobHtmlChars.value;

  const controller = new AbortController();
  const startedAt = Date.now();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    options.signal.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
  }

  try {
    let extracted: FetchedJobContent | null = null;

    const staticResult = await tryStaticFetch(url, controller.signal);
    if (staticResult) {
      const tier1 = extractFromHtml(staticResult.html, staticResult.finalUrl);
      logger.info("manual-fetch tier-1", {
        url,
        extractedLength: tier1.content.length,
        threshold: minExtracted,
      });
      if (tier1.content.length >= minExtracted) {
        extracted = tier1;
      }
    }

    if (!extracted) {
      if (minExtracted === 0 && !staticResult) {
        // Browser fallback is disabled and static fetch yielded nothing.
        throw new AppError({
          status: 502,
          code: "UPSTREAM_ERROR",
          message:
            "Static fetch returned empty body and browser fallback is disabled (manualJobFetchMinExtractedChars=0).",
        });
      }
      logger.info("manual-fetch falling back to browser", {
        url,
        reason: staticResult ? "tiny-extract" : "empty-body",
      });
      const browserStart = Date.now();
      const remainingMs = Math.max(1_000, timeoutMs - (Date.now() - startedAt));
      const browserResult = await tryBrowserFetch(url, remainingMs, settleMs);
      logger.info("manual-fetch tier-2 done", {
        url,
        durationMs: Date.now() - browserStart,
      });
      extracted = extractFromHtml(browserResult.html, browserResult.finalUrl);
    }

    if (extracted.content.length > sizeCap) {
      throw unprocessableEntity(
        `Fetched job HTML exceeds the configured limit (${extracted.content.length} > ${sizeCap} chars).`,
        {
          field: "fetchedJobHtml",
          observed: extracted.content.length,
          max: sizeCap,
        },
      );
    }

    return { content: extracted.content, url };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new AppError({
        status: 408,
        code: "REQUEST_TIMEOUT",
        message: "Timed out fetching URL",
      });
    }
    throw new AppError({
      status: 502,
      code: "UPSTREAM_ERROR",
      message: error instanceof Error ? error.message : "Failed to fetch URL",
    });
  } finally {
    clearTimeout(timeout);
  }
}

/** Raw response type from the API (all fields are strings) */
interface ManualJobApiResponse {
  title: string;
  employer: string;
  location: string;
  salary: string;
  deadline: string;
  jobUrl: string;
  applicationLink: string;
  jobType: string;
  jobLevel: string;
  jobFunction: string;
  disciplines: string;
  degreeRequired: string;
  starting: string;
  jobDescription: string;
}

/** JSON schema for manual job extraction response */
const MANUAL_JOB_SCHEMA: JsonSchemaDefinition = {
  name: "manual_job_details",
  schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Job title" },
      employer: { type: "string", description: "Company/employer name" },
      location: { type: "string", description: "Job location" },
      salary: { type: "string", description: "Salary information" },
      deadline: { type: "string", description: "Application deadline" },
      jobUrl: { type: "string", description: "URL of the job listing" },
      applicationLink: {
        type: "string",
        description: "Direct application URL",
      },
      jobType: {
        type: "string",
        description: "Employment type (full-time, part-time, etc.)",
      },
      jobLevel: {
        type: "string",
        description: "Seniority level (entry, mid, senior, etc.)",
      },
      jobFunction: { type: "string", description: "Job function/category" },
      disciplines: {
        type: "string",
        description: "Required disciplines or fields",
      },
      degreeRequired: {
        type: "string",
        description: "Required degree or education",
      },
      starting: { type: "string", description: "Start date information" },
      jobDescription: {
        type: "string",
        description:
          "Clean text job description with responsibilities and requirements",
      },
    },
    required: [
      "title",
      "employer",
      "location",
      "salary",
      "deadline",
      "jobUrl",
      "applicationLink",
      "jobType",
      "jobLevel",
      "jobFunction",
      "disciplines",
      "degreeRequired",
      "starting",
      "jobDescription",
    ],
    additionalProperties: false,
  },
};

export async function inferManualJobDetails(
  jobDescription: string,
): Promise<ManualJobInferenceResult> {
  const model = await resolveLlmModel();
  const prompt = await loadPrompt("job-fetch-from-url", { jobDescription });

  const llm = new LlmService();
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (prompt.system) {
    messages.push({ role: "system", content: prompt.system });
  }
  messages.push({ role: "user", content: prompt.user });

  const result = await llm.callJson<ManualJobApiResponse>({
    model,
    messages,
    jsonSchema: MANUAL_JOB_SCHEMA,
    label: "infer job from URL",
  });

  if (!result.success) {
    if (result.error.toLowerCase().includes("api key")) {
      return {
        job: {},
        warning: "LLM API key not set. Fill details manually.",
      };
    }
    logger.warn("Manual job inference failed", { error: result.error });
    return {
      job: {},
      warning: "AI inference failed. Fill details manually.",
    };
  }

  return { job: normalizeDraft(result.data) };
}

function normalizeDraft(parsed: ManualJobApiResponse): ManualJobDraft {
  const out: ManualJobDraft = {};

  // Map each field, only including non-empty strings
  if (parsed.title?.trim()) out.title = parsed.title.trim();
  if (parsed.employer?.trim()) out.employer = parsed.employer.trim();
  if (parsed.location?.trim()) out.location = parsed.location.trim();
  if (parsed.salary?.trim()) out.salary = parsed.salary.trim();
  if (parsed.deadline?.trim()) out.deadline = parsed.deadline.trim();
  if (parsed.jobUrl?.trim()) out.jobUrl = parsed.jobUrl.trim();
  if (parsed.applicationLink?.trim())
    out.applicationLink = parsed.applicationLink.trim();
  if (parsed.jobType?.trim()) out.jobType = parsed.jobType.trim();
  if (parsed.jobLevel?.trim()) out.jobLevel = parsed.jobLevel.trim();
  if (parsed.jobFunction?.trim()) out.jobFunction = parsed.jobFunction.trim();
  if (parsed.disciplines?.trim()) out.disciplines = parsed.disciplines.trim();
  if (parsed.degreeRequired?.trim())
    out.degreeRequired = parsed.degreeRequired.trim();
  if (parsed.starting?.trim()) out.starting = parsed.starting.trim();
  if (parsed.jobDescription?.trim())
    out.jobDescription = parsed.jobDescription.trim();

  return out;
}
