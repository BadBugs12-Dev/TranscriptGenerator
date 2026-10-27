import "server-only";
import { CaptionError, type CaptionErrorCode } from "./errors";
import { retrieveTranscriptViaInvidious } from "./invidious";
import { retrieveTranscript as retrieveTranscriptLocal } from "./retrieve";
import type { TranscriptResult } from "./types";

const REMOTE_TIMEOUT_MS = 30_000;
const REMOTE_MAX_BYTES = 12 * 1024 * 1024;
const captionErrorCodes = new Set<CaptionErrorCode>([
  "INVALID_URL",
  "VIDEO_UNAVAILABLE",
  "VIDEO_RESTRICTED",
  "NO_CAPTIONS",
  "LANGUAGE_UNAVAILABLE",
  "YOUTUBE_BLOCKED",
  "YOUTUBE_TIMEOUT",
  "YOUTUBE_FAILURE",
]);
const invidiousFallbackCodes = new Set<CaptionErrorCode>([
  "YOUTUBE_BLOCKED",
  "YOUTUBE_TIMEOUT",
  "YOUTUBE_FAILURE",
]);

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isCaptionErrorCode(value: unknown): value is CaptionErrorCode {
  return typeof value === "string" && captionErrorCodes.has(value as CaptionErrorCode);
}

function isTranscriptResult(value: unknown): value is TranscriptResult {
  const result = object(value);
  if (
    typeof result.videoId !== "string" || typeof result.title !== "string" ||
    typeof result.channel !== "string" || typeof result.thumbnail !== "string" ||
    (result.duration !== null && typeof result.duration !== "number") ||
    typeof result.language !== "string" || !Array.isArray(result.languages) || !Array.isArray(result.segments)
  ) return false;
  if (result.languages.length > 200 || result.segments.length > 30_000) return false;
  return result.languages.every((raw) => {
    const language = object(raw);
    return typeof language.id === "string" && typeof language.label === "string" && typeof language.code === "string";
  }) && result.segments.every((raw) => {
    const segment = object(raw);
    return typeof segment.text === "string" && typeof segment.start === "number" && Number.isFinite(segment.start) &&
      typeof segment.duration === "number" && Number.isFinite(segment.duration);
  });
}

function remoteEndpoint(): URL | null {
  const raw = process.env.CAPTION_SERVICE_URL?.trim();
  if (!raw) return null;
  let base: URL;
  try { base = new URL(raw); } catch { throw new CaptionError("YOUTUBE_FAILURE"); }
  const localDevelopment = process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1"].includes(base.hostname);
  if ((base.protocol !== "https:" && !(localDevelopment && base.protocol === "http:")) || base.username || base.password) {
    throw new CaptionError("YOUTUBE_FAILURE");
  }
  return new URL("/api/internal/caption", base);
}

async function readRemoteJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > REMOTE_MAX_BYTES) throw new CaptionError("YOUTUBE_FAILURE");
  if (!response.body) throw new CaptionError("YOUTUBE_FAILURE");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let body = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > REMOTE_MAX_BYTES) throw new CaptionError("YOUTUBE_FAILURE");
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof CaptionError) throw error;
    throw new CaptionError("YOUTUBE_FAILURE");
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function retrieveRemote(endpoint: URL, input: string, language?: string): Promise<TranscriptResult> {
  const secret = process.env.CAPTION_SERVICE_SECRET;
  if (!secret || secret.length < 32) throw new CaptionError("YOUTUBE_FAILURE");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: input, language }),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
    const payload = object(await readRemoteJson(response));
    if (!response.ok) {
      if (isCaptionErrorCode(payload.code)) throw new CaptionError(payload.code);
      throw new CaptionError("YOUTUBE_FAILURE");
    }
    if (!isTranscriptResult(payload.result)) throw new CaptionError("YOUTUBE_FAILURE");
    return payload.result;
  } catch (error) {
    if (error instanceof CaptionError) throw error;
    if (controller.signal.aborted) throw new CaptionError("YOUTUBE_TIMEOUT");
    throw new CaptionError("YOUTUBE_FAILURE");
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

async function retrieveLocalWithFallback(input: string, language?: string): Promise<TranscriptResult> {
  if (language?.startsWith("iv:")) return retrieveTranscriptViaInvidious(input, language);

  try {
    return await retrieveTranscriptLocal(input, language);
  } catch (error) {
    if (!(error instanceof CaptionError) || !invidiousFallbackCodes.has(error.code)) throw error;
    try {
      return await retrieveTranscriptViaInvidious(input, language);
    } catch (fallbackError) {
      if (fallbackError instanceof CaptionError && ["NO_CAPTIONS", "LANGUAGE_UNAVAILABLE", "VIDEO_UNAVAILABLE", "VIDEO_RESTRICTED"].includes(fallbackError.code)) {
        throw fallbackError;
      }
      throw error;
    }
  }
}

export async function retrieveTranscript(input: string, language?: string): Promise<TranscriptResult> {
  const endpoint = remoteEndpoint();
  return endpoint ? retrieveRemote(endpoint, input, language) : retrieveLocalWithFallback(input, language);
}
