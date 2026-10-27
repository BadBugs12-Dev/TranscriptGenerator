import "server-only";
import { CaptionError } from "./errors";
import type { WebPoContext } from "./po-token";
import { parseYouTubeUrl } from "./url";
import type { CaptionLanguage, TranscriptResult, TranscriptSegment } from "./types";

type ObjectValue = Record<string, unknown>;
type Track = CaptionLanguage & { baseUrl: string; generated: boolean };
type Client = { label: string; id: string; userAgent: string; context: ObjectValue; po?: WebPoContext };
type WebPoProvider = (videoId: string) => Promise<WebPoContext>;

const object = (value: unknown): ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown): string => typeof value === "string" ? value : "";
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

// Fallback clients remain useful when PO-token initialization is unavailable or
// YouTube is not enforcing the Web subtitles token for a particular request.
const fallbackClients: Client[] = [
  {
    label: "android",
    id: "3",
    userAgent: "com.google.android.youtube/21.26.364 (Linux; U; Android 11) gzip",
    context: { clientName: "ANDROID", clientVersion: "21.26.364", androidSdkVersion: 30, hl: "en", gl: "US" },
  },
  {
    label: "ios",
    id: "5",
    userAgent: "com.google.ios.youtube/21.26.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
    context: { clientName: "IOS", clientVersion: "21.26.4", deviceMake: "Apple", deviceModel: "iPhone16,2", osName: "iPhone", osVersion: "18.3.2.22D82", hl: "en", gl: "US" },
  },
];

const TOTAL_TIMEOUT_MS = 25_000;
const REQUEST_TIMEOUT_MS = 8_000;
const PLAYER_MAX_BYTES = 2 * 1024 * 1024;
const CAPTION_MAX_BYTES = 8 * 1024 * 1024;
const MAX_SEGMENTS = 30_000;
const MAX_TEXT_CHARACTERS = 2_000_000;

function safePath(url: string): string {
  try { return new URL(url).pathname; } catch { return "unknown"; }
}

async function readJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  maxBytes: number,
  deadline: number,
  stage: string,
): Promise<unknown> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new CaptionError("YOUTUBE_TIMEOUT");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, remaining));
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetchImpl(url, { ...init, redirect: "error", cache: "no-store", signal: controller.signal });
    if (response.status === 429 || response.status === 403) {
      console.warn("YouTube request blocked", { stage, status: response.status, path: safePath(url) });
      throw new CaptionError("YOUTUBE_BLOCKED");
    }
    if (!response.ok || !response.body) {
      console.warn("YouTube request failed", { stage, status: response.status, path: safePath(url) });
      throw new CaptionError("YOUTUBE_FAILURE");
    }
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
    if (!body.trim()) {
      console.warn("YouTube returned an empty response", { stage, status: response.status, path: safePath(url) });
      throw new CaptionError("YOUTUBE_BLOCKED");
    }
    try {
      return JSON.parse(body) as unknown;
    } catch {
      console.warn("YouTube returned non-JSON data", { stage, status: response.status, path: safePath(url) });
      throw new CaptionError("YOUTUBE_FAILURE");
    }
  } catch (error) {
    if (error instanceof CaptionError) throw error;
    if (controller.signal.aborted) {
      console.warn("YouTube request timed out", { stage, path: safePath(url) });
      throw new CaptionError("YOUTUBE_TIMEOUT");
    }
    console.warn("YouTube request threw", { stage, path: safePath(url) });
    throw new CaptionError("YOUTUBE_FAILURE");
  } finally {
    clearTimeout(timer);
    if (reader) await reader.cancel().catch(() => undefined);
    controller.abort();
  }
}

function captionUrl(baseUrl: string, videoId: string, po?: WebPoContext): string {
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new CaptionError("YOUTUBE_FAILURE"); }
  if (
    url.protocol !== "https:" || !["www.youtube.com", "youtube.com"].includes(url.hostname) ||
    url.port || url.username || url.password || url.pathname !== "/api/timedtext" ||
    url.searchParams.getAll("v").length !== 1 || url.searchParams.get("v") !== videoId
  ) throw new CaptionError("YOUTUBE_FAILURE");
  url.searchParams.set("fmt", "json3");
  if (po) {
    url.searchParams.set("c", "WEB");
    url.searchParams.set("cver", po.clientVersion);
    url.searchParams.set("cplayer", "UNIPLAYER");
    url.searchParams.set("potc", "1");
    url.searchParams.set("pot", po.poToken);
  }
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
    if (!text) continue;
    if (!finite(event.tStartMs) || event.tStartMs < 0 || (event.dDurationMs !== undefined && (!finite(event.dDurationMs) || event.dDurationMs < 0))) {
      throw new CaptionError("YOUTUBE_FAILURE");
    }
    const start = event.tStartMs / 1000;
    const duration = finite(event.dDurationMs) ? event.dDurationMs / 1000 : 0;
    const previous = segments[segments.length - 1];
    if (previous?.text === text && previous.start === start && previous.duration === duration) continue;
    characters += text.length;
    if (characters > MAX_TEXT_CHARACTERS || segments.length >= MAX_SEGMENTS) throw new CaptionError("YOUTUBE_FAILURE");
    segments.push({ text, start, duration });
  }
  return segments.sort((left, right) => left.start - right.start);
}

function webClient(po: WebPoContext): Client {
  return {
    label: "web-pot",
    id: "1",
    userAgent: po.userAgent,
    po,
    context: {
      clientName: "WEB",
      clientVersion: po.clientVersion,
      hl: "en",
      gl: "US",
      visitorData: po.visitorData || undefined,
      utcOffsetMinutes: 0,
    },
  };
}

function playerUrl(client: Client): string {
  const url = new URL("https://www.youtube.com/youtubei/v1/player");
  if (client.po?.apiKey && /^[a-zA-Z0-9_-]{20,80}$/.test(client.po.apiKey)) url.searchParams.set("key", client.po.apiKey);
  return url.toString();
}

/** Test seam for exercising the complete server protocol without real network access. */
export function createCaptionRetriever(fetchImpl: typeof fetch, getWebPoContext?: WebPoProvider) {
  return async function retrieve(input: string, language?: string): Promise<TranscriptResult> {
    const { videoId } = parseYouTubeUrl(input);
    if (language !== undefined && (typeof language !== "string" || !/^[a-zA-Z0-9_.:-]{1,150}$/.test(language))) {
      throw new CaptionError("LANGUAGE_UNAVAILABLE");
    }

    const deadline = Date.now() + TOTAL_TIMEOUT_MS;
    const attempts: Client[] = [];
    if (getWebPoContext) {
      try {
        attempts.push(webClient(await getWebPoContext(videoId)));
      } catch {
        console.warn("YouTube WebPO token generation failed; using fallback clients", { videoId });
      }
    }
    attempts.push(...fallbackClients);

    const failures: CaptionError[] = [];
    for (const client of attempts) {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "User-Agent": client.userAgent,
          "X-Youtube-Client-Name": client.id,
          "X-Youtube-Client-Version": String(client.context.clientVersion),
        };
        if (client.po?.visitorData) headers["X-Goog-Visitor-Id"] = client.po.visitorData;
        const requestBody: ObjectValue = { context: { client: client.context }, videoId };
        if (client.po) requestBody.serviceIntegrityDimensions = { poToken: client.po.poToken };

        const player = object(await readJson(fetchImpl, playerUrl(client), {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody),
        }, PLAYER_MAX_BYTES, deadline, `player:${client.label}`));
        const details = assertPlayable(player, videoId);
        const tracks = captionTracks(player);
        const selected = language
          ? tracks.find((track) => track.id === language) || tracks.find((track) => track.code === language && !track.generated) || tracks.find((track) => track.code === language)
          : tracks.find((track) => track.code.startsWith("en") && !track.generated) || tracks.find((track) => track.code.startsWith("en")) || tracks[0];
        if (!selected) throw new CaptionError("LANGUAGE_UNAVAILABLE");

        const captions = await readJson(fetchImpl, captionUrl(selected.baseUrl, videoId, client.po), {
          headers: {
            "User-Agent": client.userAgent,
            ...(client.po?.visitorData ? { "X-Goog-Visitor-Id": client.po.visitorData } : {}),
          },
        }, CAPTION_MAX_BYTES, deadline, `caption:${client.label}`);
        const segments = parseCaptionSegments(captions);
        if (!segments.length) throw new CaptionError("NO_CAPTIONS");
        const duration = Number(details.lengthSeconds);
        return {
          videoId,
          title: string(details.title).slice(0, 1000),
          channel: string(details.author).slice(0, 300),
          thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
          duration: Number.isFinite(duration) && duration > 0 ? duration : null,
          languages: tracks.map(({ id, label, code }) => ({ id, label, code })),
          language: selected.id,
          segments,
        };
      } catch (error) {
        failures.push(error instanceof CaptionError ? error : new CaptionError("YOUTUBE_FAILURE"));
      }
    }

    if (failures.length && failures.every((error) => error.code === "NO_CAPTIONS")) throw new CaptionError("NO_CAPTIONS");
    const priority = ["YOUTUBE_BLOCKED", "YOUTUBE_TIMEOUT", "LANGUAGE_UNAVAILABLE", "VIDEO_RESTRICTED", "VIDEO_UNAVAILABLE", "YOUTUBE_FAILURE"];
    throw failures.find((error) => error.code === priority.find((code) => failures.some((failure) => failure.code === code))) ?? new CaptionError("YOUTUBE_FAILURE");
  };
}

async function createWebPoContextLazy(videoId: string): Promise<WebPoContext> {
  const { createWebPoContext } = await import("./po-token");
  return createWebPoContext(videoId);
}

export const retrieveTranscript = createCaptionRetriever((...args) => fetch(...args), createWebPoContextLazy);
