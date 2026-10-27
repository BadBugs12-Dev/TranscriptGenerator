import "server-only";
import { BotGuardClient } from "bgutils-js/botguard";
import type { WebPoSignalOutput } from "bgutils-js/shared-types";
import { buildURL, getHeaders, parseLooseJSON, USER_AGENT } from "bgutils-js/utils";
import { WebPoMinter } from "bgutils-js/webpo";
import { JSDOM } from "jsdom";

type ObjectValue = Record<string, unknown>;

export type WebPoContext = {
  poToken: string;
  visitorData: string;
  clientVersion: string;
  apiKey: string;
  userAgent: string;
};

type PoState = {
  minter: WebPoMinter;
  visitorData: string;
  clientVersion: string;
  apiKey: string;
  userAgent: string;
  expiresAt: number;
  dom: JSDOM;
};

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const INIT_TIMEOUT_MS = 8_000;
const PAGE_MAX_BYTES = 6 * 1024 * 1024;
const CACHE_MAX_MS = 15 * 60 * 1000;
const FAILURE_BACKOFF_MS = 30_000;

let cached: PoState | null = null;
let initializing: Promise<PoState> | null = null;
let failedUntil = 0;

const object = (value: unknown): ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const string = (value: unknown): string => typeof value === "string" ? value : "";

async function fetchText(url: string, init: RequestInit, maxBytes: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INIT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, redirect: "error", cache: "no-store", signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Response too large");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let body = "";
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > maxBytes) throw new Error("Response too large");
        body += decoder.decode(part.value, { stream: true });
      }
      body += decoder.decode();
      return body;
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function readYouTubeConfig(pageHtml: string): ObjectValue {
  const config: ObjectValue = {};
  for (const match of pageHtml.matchAll(/ytcfg\.set\((\{.+?\})\);/gs)) {
    try { Object.assign(config, JSON.parse(match[1]) as ObjectValue); } catch { /* ignore unrelated malformed config chunks */ }
  }
  return config;
}

async function initialize(): Promise<PoState> {
  const pageHtml = await fetchText("https://www.youtube.com/", {
    headers: {
      "Accept": "text/html,application/xhtml+xml",
      "Accept-Language": "en-US,en;q=0.8",
      "User-Agent": USER_AGENT,
    },
  }, PAGE_MAX_BYTES);

  const ytConfig = readYouTubeConfig(pageHtml);
  const innertubeContext = object(ytConfig.INNERTUBE_CONTEXT);
  const clientConfig = object(innertubeContext.client);
  const visitorData = string(clientConfig.visitorData) || string(ytConfig.VISITOR_DATA);
  const clientVersion = string(clientConfig.clientVersion) || string(ytConfig.INNERTUBE_CONTEXT_CLIENT_VERSION);
  const apiKey = string(ytConfig.INNERTUBE_API_KEY);
  if (!clientVersion) throw new Error("Missing YouTube web client version");

  const attestationMatch = pageHtml.match(/window\.ytAtN\(\s*({[\s\S]*?})\s*\)/);
  if (!attestationMatch) throw new Error("Missing YouTube BotGuard challenge");
  const attestation = object(parseLooseJSON(attestationMatch[1]));
  const challengeResponse = object(attestation.R);
  const bgChallenge = object(challengeResponse.bgChallenge);
  const program = string(bgChallenge.program);
  const globalName = string(bgChallenge.globalName);
  const interpreterData = object(bgChallenge.interpreterUrl);
  const interpreterPath = string(interpreterData.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue);
  if (!program || !globalName || !interpreterPath) throw new Error("Incomplete YouTube BotGuard challenge");

  const interpreterUrl = new URL(interpreterPath.startsWith("//") ? `https:${interpreterPath}` : interpreterPath, "https://www.youtube.com");
  if (interpreterUrl.protocol !== "https:" || !["www.youtube.com", "youtube.com"].includes(interpreterUrl.hostname)) {
    throw new Error("Unexpected BotGuard interpreter host");
  }
  const interpreterJavascript = await fetchText(interpreterUrl.toString(), {
    headers: { "User-Agent": USER_AGENT },
  }, 3 * 1024 * 1024);

  const dom = new JSDOM("<!doctype html><html><head></head><body></body></html>", {
    url: "https://www.youtube.com/",
    referrer: "https://www.youtube.com/",
    runScripts: "outside-only",
  });
  Object.defineProperty(dom.window.navigator, "userAgent", { value: USER_AGENT, configurable: true });
  (dom.window as unknown as { yt: { config_: ObjectValue } }).yt = { config_: ytConfig };
  dom.window.eval(interpreterJavascript);

  const botGuardClient = await BotGuardClient.create({
    program,
    globalName,
    globalObject: dom.window as unknown as typeof globalThis,
  });
  const webPoSignalOutput: WebPoSignalOutput = [];
  const botguardResponse = await botGuardClient.snapshot({ webPoSignalOutput });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), INIT_TIMEOUT_MS);
  let integrityResponse: Response;
  try {
    integrityResponse = await fetch(buildURL("GenerateIT", true), {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify([REQUEST_KEY, botguardResponse]),
      cache: "no-store",
      redirect: "error",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!integrityResponse.ok) throw new Error(`Integrity HTTP ${integrityResponse.status}`);
  const integrityJson = await integrityResponse.json() as [string, number, number, string];
  const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = integrityJson;
  if (!integrityToken) throw new Error("Missing YouTube integrity token");

  const minter = await WebPoMinter.create({
    integrityToken,
    estimatedTtlSecs,
    mintRefreshThreshold,
    websafeFallbackToken,
  }, webPoSignalOutput);
  const ttlMs = Number.isFinite(estimatedTtlSecs) && estimatedTtlSecs > 60
    ? Math.min(CACHE_MAX_MS, estimatedTtlSecs * 800)
    : 5 * 60 * 1000;

  return {
    minter,
    visitorData,
    clientVersion,
    apiKey,
    userAgent: USER_AGENT,
    expiresAt: Date.now() + ttlMs,
    dom,
  };
}

async function getState(): Promise<PoState> {
  if (cached && cached.expiresAt > Date.now()) return cached;
  if (Date.now() < failedUntil) throw new Error("PO token initialization is backing off");
  if (!initializing) {
    initializing = initialize().then((state) => {
      cached?.dom.window.close();
      cached = state;
      failedUntil = 0;
      return state;
    }).catch((error) => {
      failedUntil = Date.now() + FAILURE_BACKOFF_MS;
      throw error;
    }).finally(() => {
      initializing = null;
    });
  }
  return initializing;
}

export async function createWebPoContext(videoId: string): Promise<WebPoContext> {
  if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) throw new Error("Invalid video id");
  const state = await getState();
  const poToken = await state.minter.mintAsWebsafeString(videoId);
  if (!poToken || poToken.length > 4096) throw new Error("Invalid YouTube PO token");
  return {
    poToken,
    visitorData: state.visitorData,
    clientVersion: state.clientVersion,
    apiKey: state.apiKey,
    userAgent: state.userAgent,
  };
}
