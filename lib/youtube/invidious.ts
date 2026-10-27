import "server-only";
import { CaptionError } from "./errors";
import { parseYouTubeUrl } from "./url";
import type { CaptionLanguage, TranscriptResult, TranscriptSegment } from "./types";

type ObjectValue = Record<string, unknown>;
type InvidiousTrack = { label: string; code: string; index: number };

type InstanceCache = { values: string[]; expiresAt: number };

const REGISTRY_URL = "https://api.invidious.io/instances.json";
const STATIC_INSTANCES = ["https://yt.chocolatemoo53.com"];
const REGISTRY_CACHE_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 6_000;
const TOTAL_TIMEOUT_MS = 18_000;
const JSON_MAX_BYTES = 4 * 1024 * 1024;
const VTT_MAX_BYTES = 8 * 1024 * 1024;
const MAX_SEGMENTS = 30_000;
const MAX_TEXT_CHARACTERS = 2_000_000;

let instanceCache: InstanceCache | null = null;

const object = (value: unknown): ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const string = (value: unknown): string => typeof value === "string" ? value : "";

function safeInstance(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) return null;
  if (url.pathname !== "/" || url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".local") || /^\d+(?:\.\d+){3}$/.test(host) || host.includes(":")) return null;
  return `https://${host}`;
}

async function readBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Response too large");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new Error("Response too large");
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
    return body;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function fetchText(url: string, maxBytes: number, deadline: number, accept: string): Promise<string> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new CaptionError("YOUTUBE_TIMEOUT");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(REQUEST_TIMEOUT_MS, remaining));
  try {
    const response = await fetch(url, {
      headers: { "Accept": accept, "User-Agent": "TranscriptGenerator/1.0" },
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    return await readBody(response, maxBytes);
  } catch (error) {
    if (controller.signal.aborted) throw new CaptionError("YOUTUBE_TIMEOUT");
    if (error instanceof CaptionError) throw error;
    throw new CaptionError("YOUTUBE_FAILURE");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function fetchJson(url: string, deadline: number): Promise<unknown> {
  const text = await fetchText(url, JSON_MAX_BYTES, deadline, "application/json");
  try { return JSON.parse(text) as unknown; } catch { throw new CaptionError("YOUTUBE_FAILURE"); }
}

async function discoverInstances(deadline: number): Promise<string[]> {
  if (instanceCache && instanceCache.expiresAt > Date.now()) return instanceCache.values;
  const values: string[] = [...STATIC_INSTANCES];
  try {
    const registry = await fetchJson(REGISTRY_URL, Math.min(deadline, Date.now() + 3_000));
    for (const entry of array(registry)) {
      if (!Array.isArray(entry) || entry.length < 2) continue;
      const info = object(entry[1]);
      if (info.api !== true || info.type !== "https") continue;
      const monitor = object(info.monitor);
      if (monitor.down === true) continue;
      const candidate = safeInstance(string(info.uri));
      if (candidate && !values.includes(candidate)) values.push(candidate);
      if (values.length >= 6) break;
    }
  } catch {
    // The static seed keeps the fallback usable if the registry is temporarily unavailable.
  }
  instanceCache = { values, expiresAt: Date.now() + REGISTRY_CACHE_MS };
  return values;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, raw: string) => String.fromCodePoint(Math.min(Number(raw), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);/gi, (_, raw: string) => String.fromCodePoint(Math.min(parseInt(raw, 16), 0x10ffff)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'");
}

function parseTimestamp(raw: string): number | null {
  const value = raw.trim().replace(",", ".");
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const seconds = Number(parts.pop());
  const minutes = Number(parts.pop());
  const hours = parts.length ? Number(parts.pop()) : 0;
  if (![seconds, minutes, hours].every(Number.isFinite) || seconds < 0 || minutes < 0 || hours < 0) return null;
  return hours * 3600 + minutes * 60 + seconds;
}

function parseVtt(vtt: string): TranscriptSegment[] {
  const normalized = vtt.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!/^WEBVTT(?:\s|$)/.test(normalized)) throw new CaptionError("YOUTUBE_FAILURE");
  const blocks = normalized.split(/\n{2,}/);
  const segments: TranscriptSegment[] = [];
  let characters = 0;

  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trimEnd());
    const timingIndex = lines.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;
    const [startRaw, endAndSettings] = lines[timingIndex].split("-->", 2);
    const endRaw = endAndSettings?.trim().split(/\s+/, 1)[0];
    const start = parseTimestamp(startRaw);
    const end = endRaw ? parseTimestamp(endRaw) : null;
    if (start === null || end === null || end < start) continue;
    const text = decodeEntities(lines.slice(timingIndex + 1).join(" "))
      .replace(/<[^>]*>/g, "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const previous = segments[segments.length - 1];
    if (previous?.text === text && Math.abs(previous.start - start) < 0.001) continue;
    characters += text.length;
    if (characters > MAX_TEXT_CHARACTERS || segments.length >= MAX_SEGMENTS) throw new CaptionError("YOUTUBE_FAILURE");
    segments.push({ text, start, duration: end - start });
  }

  if (!segments.length) throw new CaptionError("NO_CAPTIONS");
  return segments;
}

function normalizeTracks(value: unknown): InvidiousTrack[] {
  const tracks: InvidiousTrack[] = [];
  for (const raw of array(value).slice(0, 200)) {
    const item = object(raw);
    const label = (string(item.label) || string(item.name)).trim();
    const code = (string(item.languageCode) || string(item.language_code) || string(item.code)).trim();
    if (!label || !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(code)) continue;
    tracks.push({ label: label.slice(0, 200), code, index: tracks.length });
  }
  return tracks;
}

function selectedTrack(tracks: InvidiousTrack[], language?: string): InvidiousTrack | undefined {
  if (language?.startsWith("iv:")) {
    const index = Number(language.slice(3));
    if (Number.isInteger(index) && index >= 0) return tracks[index];
  }
  if (language) return tracks.find((track) => track.code === language);
  return tracks.find((track) => track.code.startsWith("en") && !/auto|generated/i.test(track.label))
    ?? tracks.find((track) => track.code.startsWith("en"))
    ?? tracks[0];
}

function languages(tracks: InvidiousTrack[]): CaptionLanguage[] {
  return tracks.map((track) => ({ id: `iv:${track.index}`, label: track.label, code: track.code }));
}

async function retrieveFromInstance(base: string, videoId: string, language: string | undefined, deadline: number): Promise<TranscriptResult> {
  const info = object(await fetchJson(`${base}/api/v1/videos/${encodeURIComponent(videoId)}?region=US`, deadline));
  const title = string(info.title).trim();
  const channel = (string(info.author) || string(info.uploader)).trim();
  if (!title) throw new CaptionError("YOUTUBE_FAILURE");

  const tracks = normalizeTracks(info.captions);
  if (!tracks.length) throw new CaptionError("NO_CAPTIONS");
  const selected = selectedTrack(tracks, language);
  if (!selected) throw new CaptionError("LANGUAGE_UNAVAILABLE");

  const captionUrl = new URL(`/api/v1/captions/${encodeURIComponent(videoId)}`, base);
  captionUrl.searchParams.set("label", selected.label);
  captionUrl.searchParams.set("region", "US");
  const vtt = await fetchText(captionUrl.toString(), VTT_MAX_BYTES, deadline, "text/vtt,text/plain;q=0.9,*/*;q=0.1");
  const segments = parseVtt(vtt);
  const durationRaw = Number(info.lengthSeconds ?? info.duration);

  return {
    videoId,
    title: title.slice(0, 1000),
    channel: channel.slice(0, 300),
    thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    duration: Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : null,
    languages: languages(tracks),
    language: `iv:${selected.index}`,
    segments,
  };
}

export async function retrieveTranscriptViaInvidious(input: string, language?: string): Promise<TranscriptResult> {
  const { videoId } = parseYouTubeUrl(input);
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  const instances = await discoverInstances(deadline);
  let sawNoCaptions = false;
  let sawLanguageUnavailable = false;

  for (const base of instances) {
    if (Date.now() >= deadline) break;
    try {
      const result = await retrieveFromInstance(base, videoId, language, deadline);
      console.info("Caption fallback succeeded", { provider: "invidious", host: new URL(base).hostname });
      return result;
    } catch (error) {
      if (error instanceof CaptionError && error.code === "NO_CAPTIONS") sawNoCaptions = true;
      else if (error instanceof CaptionError && error.code === "LANGUAGE_UNAVAILABLE") sawLanguageUnavailable = true;
      console.warn("Caption fallback instance failed", { provider: "invidious", host: new URL(base).hostname });
    }
  }

  if (sawLanguageUnavailable) throw new CaptionError("LANGUAGE_UNAVAILABLE");
  if (sawNoCaptions) throw new CaptionError("NO_CAPTIONS");
  if (Date.now() >= deadline) throw new CaptionError("YOUTUBE_TIMEOUT");
  throw new CaptionError("YOUTUBE_FAILURE");
}
