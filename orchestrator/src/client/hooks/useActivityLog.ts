import { useSyncExternalStore } from "react";
import {
  clearActivityLog,
  getActivityLogSnapshot,
  markActivityLogRead,
  subscribeActivityLog,
} from "@/client/lib/activityLog";

export function useActivityLog() {
  const snapshot = useSyncExternalStore(
    subscribeActivityLog,
    getActivityLogSnapshot,
    getActivityLogSnapshot,
  );

  const unreadCount = snapshot.entries.filter(
    (entry) => entry.timestamp > snapshot.lastReadAt,
  ).length;

  return {
    entries: snapshot.entries,
    lastReadAt: snapshot.lastReadAt,
    unreadCount,
    clear: clearActivityLog,
    markAllRead: markActivityLogRead,
  };
}
