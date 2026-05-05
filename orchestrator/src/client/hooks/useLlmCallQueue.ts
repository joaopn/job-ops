import type { LlmCallRecord, LlmCallStreamEvent } from "@shared/types";
import { useEffect, useState } from "react";
import { subscribeToEventSource } from "@/client/lib/sse";

interface UseLlmCallQueueResult {
  active: LlmCallRecord[];
  recent: LlmCallRecord[];
  total: number;
  connected: boolean;
}

export function useLlmCallQueue(enabled = true): UseLlmCallQueueResult {
  const [calls, setCalls] = useState<LlmCallRecord[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = subscribeToEventSource<LlmCallStreamEvent>(
      "/api/llm/calls/stream",
      {
        onOpen: () => setConnected(true),
        onMessage: (event) => {
          if (event.type === "snapshot") {
            setCalls(event.calls);
          } else if (event.type === "update") {
            setCalls((prev) => {
              const existingIndex = prev.findIndex(
                (entry) => entry.id === event.call.id,
              );
              if (existingIndex === -1) return [...prev, event.call];
              const next = [...prev];
              next[existingIndex] = event.call;
              return next;
            });
          }
        },
        onError: () => setConnected(false),
      },
    );

    return () => {
      unsubscribe();
      setConnected(false);
    };
  }, [enabled]);

  const active: LlmCallRecord[] = [];
  const recent: LlmCallRecord[] = [];
  for (const call of calls) {
    if (call.status === "running") active.push(call);
    else recent.push(call);
  }
  active.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  recent.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

  return {
    active,
    recent,
    total: calls.length,
    connected,
  };
}
