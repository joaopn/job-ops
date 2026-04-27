// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveLlmModel } from "./modelSelection";
import { getEffectiveSettings } from "./settings";

vi.mock("./settings", () => ({
  getEffectiveSettings: vi.fn(),
}));

vi.mock("../repositories/settings", () => ({
  getAllSettings: vi.fn().mockResolvedValue({}),
  getSetting: vi.fn().mockResolvedValue(null),
}));

type Setting = { value: unknown; default?: unknown; override?: unknown };

function settings(overrides: Partial<Record<string, Setting>>): unknown {
  return {
    model: { value: "global-model", default: "global-model", override: null },
    modelScorer: { value: "global-model", override: null },
    modelTailoring: { value: "global-model", override: null },
    llmProvider: {
      value: "openrouter",
      default: "openrouter",
      override: null,
    },
    llmBaseUrl: {
      value: "https://openrouter.ai/api/v1",
      default: "https://openrouter.ai/api/v1",
      override: null,
    },
    ...overrides,
  };
}

describe("resolveLlmModel", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv, MODEL: "env-model" };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("uses purpose-specific scorer model when set", async () => {
    vi.mocked(getEffectiveSettings).mockResolvedValue(
      settings({
        modelScorer: { value: "specific-scorer-model", override: null },
      }) as Awaited<ReturnType<typeof getEffectiveSettings>>,
    );

    expect(await resolveLlmModel("scoring")).toBe("specific-scorer-model");
  });

  it("falls back to the global model setting when scorer override is unset", async () => {
    vi.mocked(getEffectiveSettings).mockResolvedValue(
      settings({}) as Awaited<ReturnType<typeof getEffectiveSettings>>,
    );

    expect(await resolveLlmModel("scoring")).toBe("global-model");
  });

  it("falls back to the MODEL env var when no settings model is configured", async () => {
    vi.mocked(getEffectiveSettings).mockResolvedValue(
      settings({
        model: { value: "", default: "", override: null },
        modelScorer: { value: "", override: null },
      }) as Awaited<ReturnType<typeof getEffectiveSettings>>,
    );

    expect(await resolveLlmModel("scoring")).toBe("env-model");
  });

  it("uses purpose-specific tailoring model when set", async () => {
    vi.mocked(getEffectiveSettings).mockResolvedValue(
      settings({
        modelTailoring: {
          value: "specific-tailoring-model",
          override: null,
        },
      }) as Awaited<ReturnType<typeof getEffectiveSettings>>,
    );

    expect(await resolveLlmModel("tailoring")).toBe("specific-tailoring-model");
  });

  it("falls back to the global model for tailoring when override is unset", async () => {
    vi.mocked(getEffectiveSettings).mockResolvedValue(
      settings({}) as Awaited<ReturnType<typeof getEffectiveSettings>>,
    );

    expect(await resolveLlmModel("tailoring")).toBe("global-model");
  });

  it("returns the global model for the default purpose", async () => {
    vi.mocked(getEffectiveSettings).mockResolvedValue(
      settings({}) as Awaited<ReturnType<typeof getEffectiveSettings>>,
    );

    expect(await resolveLlmModel("default")).toBe("global-model");
    expect(await resolveLlmModel()).toBe("global-model");
  });
});
