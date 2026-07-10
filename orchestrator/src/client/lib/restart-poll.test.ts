import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { waitForServerRestart } from "./restart-poll";

const okResponse = { ok: true } as Response;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("waitForServerRestart", () => {
  it("resolves restarted only after a down-then-up sequence", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValue(okResponse);
    vi.stubGlobal("fetch", fetchMock);

    const result = waitForServerRestart();
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(result).resolves.toBe("restarted");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never counts a success from the still-running old server", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse);
    vi.stubGlobal("fetch", fetchMock);

    const result = waitForServerRestart();
    await vi.advanceTimersByTimeAsync(61_000);

    await expect(result).resolves.toBe("timeout");
  });

  it("times out when the server never comes back", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("still down"));
    vi.stubGlobal("fetch", fetchMock);

    const result = waitForServerRestart();
    await vi.advanceTimersByTimeAsync(61_000);

    await expect(result).resolves.toBe("timeout");
  });
});
