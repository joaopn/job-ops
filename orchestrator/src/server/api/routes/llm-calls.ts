import { logger } from "@infra/logger";
import { setupSse, startSseHeartbeat, writeSseData } from "@infra/sse";
import { llmCallObserver } from "@server/services/llm/observer";
import type { LlmCallRecord, LlmCallStreamEvent } from "@shared/types";
import { type Request, type Response, Router } from "express";

export const llmCallsRouter = Router();

/**
 * GET /api/llm/calls/stream - Live feed of LLM calls (active + recent).
 * Emits a `snapshot` event on connect, then `update` events for each
 * register/finalize.
 */
llmCallsRouter.get("/stream", (req: Request, res: Response) => {
  const requestId = String(res.getHeader("x-request-id") || "unknown");

  setupSse(res, {
    cacheControl: "no-cache, no-transform",
    disableBuffering: true,
    flushHeaders: true,
  });
  const stopHeartbeat = startSseHeartbeat(res);

  let clientDisconnected = false;
  const isWritable = () =>
    !clientDisconnected && !res.writableEnded && !res.destroyed;

  const sendEvent = (event: LlmCallStreamEvent) => {
    if (!isWritable()) return;
    writeSseData(res, event);
  };

  sendEvent({
    type: "snapshot",
    calls: llmCallObserver.snapshot(),
    requestId,
  });

  const onUpdate = (call: LlmCallRecord) => {
    sendEvent({ type: "update", call, requestId });
  };
  llmCallObserver.on("update", onUpdate);

  const cleanup = () => {
    clientDisconnected = true;
    stopHeartbeat();
    llmCallObserver.off("update", onUpdate);
    if (!res.writableEnded && !res.destroyed) res.end();
  };

  res.on("close", () => {
    logger.debug("LLM call stream client disconnected", { requestId });
    cleanup();
  });
  req.on("close", cleanup);
});
