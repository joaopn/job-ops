declare const __APP_VERSION__: string;

export function parseVersion(rawVersion: string): string {
  const normalized = rawVersion.trim();
  if (/^v\d+\.\d+\.\d+$/.test(normalized)) {
    return normalized;
  }
  if (/^\d+\.\d+\.\d+$/.test(normalized)) {
    return `v${normalized}`;
  }
  return normalized || "unknown";
}

export function getAppVersion(): string {
  const raw =
    typeof __APP_VERSION__ !== "undefined"
      ? (__APP_VERSION__ as string)
      : "unknown";
  return parseVersion(raw);
}
