export function safeNext(value: unknown, fallback = "/dashboard") {
  // URL parsing strips control whitespace, which could turn /\t/host into //host.
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  if (new URL(value, "https://transcript.invalid").origin !== "https://transcript.invalid") return fallback;
  return value;
}
