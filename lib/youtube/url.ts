import { CaptionError } from "./errors";

export const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
const hosts = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtu.be"]);

export function parseYouTubeUrl(input: string): { videoId: string; url: string } {
  if (typeof input !== "string" || input.length > 2048) throw new CaptionError("INVALID_URL");
  const trimmed = input.trim();
  // Support a pasted address without a scheme, but never protocol-relative URLs.
  const candidate = /^(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(trimmed)
    ? `https://${trimmed}`
    : trimmed;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new CaptionError("INVALID_URL");
  }
  if (
    !["https:", "http:"].includes(parsed.protocol) || !hosts.has(parsed.hostname) ||
    parsed.username || parsed.password || parsed.port || /[\\\u0000-\u0020]/.test(trimmed)
  ) throw new CaptionError("INVALID_URL");

  let videoId: string | null = null;
  if (parsed.hostname === "youtu.be" || parsed.hostname === "www.youtu.be") {
    videoId = /^\/([a-zA-Z0-9_-]{11})\/?$/.exec(parsed.pathname)?.[1] ?? null;
  } else if (parsed.pathname === "/watch" || parsed.pathname === "/watch/") {
    // Ambiguous duplicate identifiers are rejected instead of interpreted differently elsewhere.
    if (parsed.searchParams.getAll("v").length === 1) videoId = parsed.searchParams.get("v");
  } else {
    videoId = /^\/(?:shorts|embed|live)\/([a-zA-Z0-9_-]{11})\/?$/.exec(parsed.pathname)?.[1] ?? null;
  }
  if (!videoId || !VIDEO_ID_PATTERN.test(videoId)) throw new CaptionError("INVALID_URL");
  return { videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
}
