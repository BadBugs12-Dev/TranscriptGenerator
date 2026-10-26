import "server-only";
import { CaptionError } from "./errors";
import { parseYouTubeUrl } from "./url";
import type { CaptionLanguage, TranscriptResult, TranscriptSegment } from "./types";

type ObjectValue = Record<string, unknown>;
type Track = CaptionLanguage & { baseUrl: string; generated: boolean };
type Client = { id: string; userAgent: string; context: ObjectValue };
const object = (value: unknown): ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown): string => typeof value === "string" ? value : "";
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

// Kept in this replaceable adapter because YouTube's public player protocol is
// undocumented. These client versions were live-tested on 2026-10-26.
const clients: Client[] = [
  {
    id: "3", userAgent: "com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip",
    context: { clientName: "ANDROID", clientVersion: "21.26.364", androidSdkVersion: 30, hl: "en", gl: "US" },
  },
  {
    id: "5", userAgent: "com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    context: { clientName: "IOS", clientVersion: "21.26.4", deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82", hl: "en", gl: "US" },
  },
];

const TOTAL_TIMEOUT_MS = 22_000;
const REQUEST_TIMEOUT_MS = 7_000;
const PLAYER_MAX_BYTES = 2 * 1024 * 1024;
const CAPTION_MAX_BYTES = 8 * 1024 * 1024;
const MAX_SEGMENTS = 30_000;
const MAX_TEXT_CHARACTERS = 2_000_000;

async function readJson(
  fetchImpl: typeof fetch, url: string, init: RequestInit, maxBytes: number, deadline: number,
): Promise<unknown> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new CaptionError("YOUTUBE_TIMEOUT");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, remaining));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    // No redirects: signed caption URLs must themselves be approved endpoints.
    // Never follow a Location header to an arbitrary/private address.
    const response = await fetchImpl(url, { ...init, redirect: "error", cache: "no-store", signal: controller.signal });
    if (response.status === 429 || response.status === 403) throw new CaptionError("YOUTUBE_BLOCKED");
    if (!response.ok || !response.body) throw new CaptionError("YOUTUBE_FAILURE");
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new CaptionError("YOUTUBE_FAILURE");
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let body = "";
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maxBytes) throw new CaptionError("YOUTUBE_FAILURE");
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
    // Empty timedtext is often a token/IP block, not proof that captions do not
    // exist. Keep this distinct from the verified no-tracks state below.
    if (!body.trim()) throw new CaptionError("YOUTUBE_BLOCKED");
    try {
      return JSON.parse(body) as unknown;
    } catch {
      throw new CaptionError("YOUTUBE_FAILURE");
    }
  } catch (error) {
    if (error instanceof CaptionError) throw error;
    if (controller.signal.aborted) throw new CaptionError("YOUTUBE_TIMEOUT");
    throw new CaptionError("YOUTUBE_FAILURE");
  } finally {
    clearTimeout(timer);
    if (reader) await reader.cancel().catch(() => undefined);
    controller.abort();
  }
}

function captionUrl(baseUrl: string, videoId: string): string {
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new CaptionError("YOUTUBE_FAILURE"); }
  if (
    url.protocol !== "https:" || !["www.youtube.com", "youtube.com"].includes(url.hostname) ||
    url.port || url.username || url.password || url.pathname !== "/api/timedtext" ||
    url.searchParams.getAll("v").length !== 1 || url.searchParams.get("v") !== videoId
  ) throw new CaptionError("YOUTUBE_FAILURE");
  url.searchParams.set("fmt", "json3");
  return url.toString();
}

function assertPlayable(player: ObjectValue, videoId: string): ObjectValue {
  const playability = object(player.playabilityStatus);
  const status = string(playability.status);
  const reason = string(playability.reason).toLowerCase();
  if (/bot|unusual traffic|too many requests/.test(reason)) throw new CaptionError("YOUTUBE_BLOCKED");
  if (status === "LOGIN_REQUIRED" || /age|country|region|restricted|sign in/.test(reason)) {
    throw new CaptionError("VIDEO_RESTRICTED");
  }
  if (status === "ERROR" || status === "UNPLAYABLE" || status === "LIVE_STREAM_OFFLINE") {
    throw new CaptionError("VIDEO_UNAVAILABLE");
  }
  const details = object(player.videoDetails);
  // A consent page, incomplete response, or changed protocol is not no-captions.
  if (status !== "OK" || details.videoId !== videoId || !string(details.title)) throw new CaptionError("YOUTUBE_FAILURE");
  return details;
}

function textLabel(value: unknown): string {
  const data = object(value);
  return string(data.simpleText) || array(data.runs).map((run) => string(object(run).text)).join("");
}

function captionTracks(player: ObjectValue): Track[] {
  const rawTracks = array(object(object(player.captions).playerCaptionsTracklistRenderer).captionTracks);
  if (!rawTracks.length) throw new CaptionError("NO_CAPTIONS");
  const tracks: Track[] = [];
  for (const rawTrack of rawTracks.slice(0, 200)) {
    const track = object(rawTrack);
    const code = string(track.languageCode);
    const baseUrl = string(track.baseUrl);
    if (!/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(code) || !baseUrl || baseUrl.length > 16_384) continue;
    const generated = track.kind === "asr";
    const proposedId = string(track.vssId);
    let id = /^[a-zA-Z0-9_.:-]{1,100}$/.test(proposedId) ? proposedId : `${code}:${generated ? "auto" : "manual"}`;
    if (tracks.some((existing) => existing.id === id)) id += `:${tracks.length}`;
    const name = textLabel(track.name).slice(0, 200) || code;
    tracks.push({ id, code, label: generated && !/auto|generated/i.test(name) ? `${name} (auto-generated)` : name, generated, baseUrl });
  }
  // A nonempty but unrecognizable list is a protocol failure, not no captions.
  if (!tracks.length) throw new CaptionError("YOUTUBE_FAILURE");
  return tracks;
}

/** JSON3 contains decoded UTF-8 text, so no XML/HTML parser or speech recognition is involved. */
export function parseCaptionSegments(input: unknown): TranscriptSegment[] {
  const data = object(input);
  if (!Array.isArray(data.events)) throw new CaptionError("YOUTUBE_FAILURE");
  const segments: TranscriptSegment[] = [];
  let characters = 0;
  for (const rawEvent of data.events) {
    const event = object(rawEvent);
    const text = array(event.segs).map((segment) => string(object(segment).utf8)).join("")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
    if (!text) continue; // Skip window/style and ASR newline-only events.
    if (!finite(event.tStartMs) || event.tStartMs < 0 || (event.dDurationMs !== undefined && (!finite(event.dDurationMs) || event.dDurationMs < 0))) {
      throw new CaptionError("YOUTUBE_FAILURE");
    }
    const start = event.tStartMs / 1000;
    const duration = finite(event.dDurationMs) ? event.dDurationMs / 1000 : 0;
    const previous = segments[segments.length - 1];
    // Identical duplicate events occasionally appear in generated tracks.
    if (previous?.text === text && previous.start === start && previous.duration === duration) continue;
    characters += text.length;
    if (characters > MAX_TEXT_CHARACTERS || segments.length >= MAX_SEGMENTS) throw new CaptionError("YOUTUBE_FAILURE");
    segments.push({ text, start, duration });
  }
  return segments.sort((left, right) => left.start - right.start);
}

/** Test seam for exercising the complete server protocol without real network access. */
export function createCaptionRetriever(fetchImpl: typeof fetch) {
  return async function retrieve(input: string, language?: string): Promise<TranscriptResult> {
    const { videoId } = parseYouTubeUrl(input);
    if (language !== undefined && (typeof language !== "string" || !/^[a-zA-Z0-9_.:-]{1,150}$/.test(language))) {
      throw new CaptionError("LANGUAGE_UNAVAILABLE");
    }
    const deadline = Date.now() + TOTAL_TIMEOUT_MS;
    const failures: CaptionError[] = [];
    for (const client of clients) {
      try {
        const headers = { "Content-Type": "application/json", "User-Agent": client.userAgent, "X-Youtube-Client-Name": client.id, "X-Youtube-Client-Version": String(client.context.clientVersion) };
        const player = object(await readJson(fetchImpl, "https://www.youtube.com/youtubei/v1/player", {
          method: "POST", headers, body: JSON.stringify({ context: { client: client.context }, videoId }),
        }, PLAYER_MAX_BYTES, deadline));
        const details = assertPlayable(player, videoId);
        const tracks = captionTracks(player);
        const selected = language
          ? tracks.find((track) => track.id === language) || tracks.find((track) => track.code === language && !track.generated) || tracks.find((track) => track.code === language)
          : tracks.find((track) => track.code.startsWith("en") && !track.generated) || tracks.find((track) => track.code.startsWith("en")) || tracks[0];
        if (!selected) throw new CaptionError("LANGUAGE_UNAVAILABLE");
        const captions = await readJson(fetchImpl, captionUrl(selected.baseUrl, videoId), { headers: { "User-Agent": client.userAgent } }, CAPTION_MAX_BYTES, deadline);
        const segments = parseCaptionSegments(captions);
        if (!segments.length) throw new CaptionError("NO_CAPTIONS");
        const duration = Number(details.lengthSeconds);
        return {
          videoId, title: string(details.title).slice(0, 1000), channel: string(details.author).slice(0, 300),
          // A deterministic first-party image URL avoids returning arbitrary upstream image URLs.
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          duration: Number.isFinite(duration) && duration > 0 ? duration : null,
          languages: tracks.map(({ id, label, code }) => ({ id, label, code })),
          language: selected.id, segments,
        };
      } catch (error) {
        failures.push(error instanceof CaptionError ? error : new CaptionError("YOUTUBE_FAILURE"));
      }
    }
    // Only report no captions if both independently playable clients confirmed
    // no tracks/usable caption events. Blocks and protocol failures stay visible.
    if (failures.every((error) => error.code === "NO_CAPTIONS")) throw new CaptionError("NO_CAPTIONS");
    const priority = ["YOUTUBE_BLOCKED", "YOUTUBE_TIMEOUT", "LANGUAGE_UNAVAILABLE", "VIDEO_RESTRICTED", "VIDEO_UNAVAILABLE", "YOUTUBE_FAILURE"];
    throw failures.find((error) => error.code === priority.find((code) => failures.some((failure) => failure.code === code))) ?? new CaptionError("YOUTUBE_FAILURE");
  };
}

export const retrieveTranscript = createCaptionRetriever((...args) => fetch(...args));
