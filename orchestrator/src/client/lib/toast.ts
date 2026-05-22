import { toast as sonnerToast } from "sonner";
import {
  type ActivityLogKind,
  appendActivityLogEntry,
} from "./activityLog";

/**
 * Wraps sonner's `toast` so that every `toast.success / .error / .warning /
 * .info / .message` call is mirrored into the persistent activity log. Drop-in
 * replacement: existing call sites only swap `from "sonner"` for `from
 * "@client/lib/toast"` and everything keeps working — the wrapper preserves
 * sonner's return values (used for `toast.dismiss(id)` round-trips).
 *
 * `toast.loading` and `toast.dismiss` are forwarded but not logged: loading
 * states are ephemeral progress indicators that resolve into a final
 * success/error toast, which IS logged.
 */

type ToastArg = string | { toString?: () => string };
type ToastOptions = Parameters<typeof sonnerToast.success>[1];

function coerceText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "object") {
    // React nodes / arbitrary objects — best-effort serialization. Sonner
    // accepts ReactNode for description; the log only needs plain text.
    if ("toString" in value && typeof value.toString === "function") {
      const stringified = value.toString();
      if (stringified !== "[object Object]") return stringified;
    }
    return "";
  }
  return "";
}

function extractDescription(options: ToastOptions | undefined): string | undefined {
  if (!options) return undefined;
  const description = (options as { description?: unknown }).description;
  if (description == null) return undefined;
  const text = coerceText(description);
  return text.length > 0 ? text : undefined;
}

function log(
  kind: ActivityLogKind,
  message: ToastArg,
  options?: ToastOptions,
): void {
  const title = coerceText(message);
  if (!title) return;
  appendActivityLogEntry({
    kind,
    title,
    description: extractDescription(options),
  });
}

function makeVariant(
  kind: ActivityLogKind,
  fn: typeof sonnerToast.success,
): typeof sonnerToast.success {
  return ((message, options) => {
    log(kind, message as ToastArg, options);
    // Forward options only when the caller passed one. Otherwise we'd turn
    // `toast.success("x")` into `sonnerToast.success("x", undefined)`, which
    // breaks `toHaveBeenCalledWith("x")` matchers in tests that mock sonner.
    return options === undefined ? fn(message) : fn(message, options);
  }) as typeof sonnerToast.success;
}

const wrappedSuccess = makeVariant("success", sonnerToast.success);
const wrappedError = makeVariant("error", sonnerToast.error);
const wrappedWarning = makeVariant("warning", sonnerToast.warning);
const wrappedInfo = makeVariant("info", sonnerToast.info);
const wrappedMessage = makeVariant("message", sonnerToast.message);

type SonnerToast = typeof sonnerToast;

interface WrappedToast extends SonnerToast {}

export const toast: WrappedToast = Object.assign(
  // Calling toast(message) directly behaves like toast.message().
  ((message: ToastArg, options?: ToastOptions) => {
    log("message", message, options);
    const sonnerMessage = message as Parameters<SonnerToast>[0];
    return options === undefined
      ? sonnerToast(sonnerMessage)
      : sonnerToast(sonnerMessage, options);
  }) as SonnerToast,
  sonnerToast,
  {
    success: wrappedSuccess,
    error: wrappedError,
    warning: wrappedWarning,
    info: wrappedInfo,
    message: wrappedMessage,
  },
);
