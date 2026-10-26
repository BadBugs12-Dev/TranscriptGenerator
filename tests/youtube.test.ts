import assert from "node:assert/strict";
import test from "node:test";
import { CaptionError } from "../lib/youtube/errors";
import { createCaptionRetriever, parseCaptionSegments } from "../lib/youtube/retrieve";
import { parseYouTubeUrl } from "../lib/youtube/url";
import { formatTimestamp, formatTranscript } from "../lib/transcript-format";

const videoId = "jNQXAC9IVRw";
const url = `https://www.youtube.com/watch?v=${videoId}`;
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const track = (code: string, generated = false) => ({
  baseUrl: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${code}&fmt=srv3`,
  vssId: `${generated ? "a" : ""}.${code}`, languageCode: code, kind: generated ? "asr" : undefined,
  name: { runs: [{ text: code === "de" ? "German" : "English" }] },
});
const player = (tracks: unknown[] | undefined = [track("en", true), track("de"), track("en")]) => ({
  playabilityStatus: { status: "OK" },
  videoDetails: { videoId, title: "Me at the zoo", author: "jawed", lengthSeconds: "19" },
  ...(tracks === undefined ? {} : { captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } }),
});
const captionDocument = { events: [
  { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Hello\n" }, { utf8: "world & friends." }] },
  { tStartMs: 1125, dDurationMs: 2250, segs: [{ utf8: "Another caption." }] },
] };
const hasCode = (code: string) => (error: unknown) => error instanceof CaptionError && error.code === code;

test("normalizes supported pasted addresses and ignores unrelated URL parameters", () => {
  for (const value of [url, `youtube.com/watch?v=${videoId}`, `https://youtu.be/${videoId}?t=3`, `https://youtube.com/shorts/${videoId}`, `https://m.youtube.com/watch?v=${videoId}&si=share`, `http://www.youtube.com/watch?v=${videoId}`]) {
    assert.deepEqual(parseYouTubeUrl(value), { videoId, url });
  }
});

test("rejects unsupported, ambiguous, and SSRF-oriented URLs", () => {
  for (const value of [
    "http://127.0.0.1/watch?v=jNQXAC9IVRw", "http://169.254.169.254/", `https://youtube.com.evil.test/watch?v=${videoId}`,
    `https://www.youtube.com@localhost/watch?v=${videoId}`, `https://evil.test/?url=${url}`, `file://youtube.com/watch?v=${videoId}`,
    `https://www.youtube.com:8080/watch?v=${videoId}`, `https://youtu.be/${videoId}X`, `https://youtu.be/${videoId}/extra`,
    `${url}&v=dQw4w9WgXcQ`, `https://www.youtube.com/redirect?v=${videoId}`, `https://www.youtube.com/watch?v=${videoId}%0A`,
    `https://www.youtube.com\\@localhost/watch?v=${videoId}`, videoId, "", "x".repeat(2049),
  ]) assert.throws(() => parseYouTubeUrl(value), hasCode("INVALID_URL"), value);
});

test("retrieves metadata, manual preferred language, UTF-8 caption text, and timestamps", async () => {
  const calls: { url: string; options: RequestInit | undefined }[] = [];
  const retrieve = createCaptionRetriever(async (request, options) => {
    const requested = String(request);
    calls.push({ url: requested, options });
    return requested.includes("/youtubei/") ? json(player()) : json(captionDocument);
  });
  const result = await retrieve(url);
  assert.equal(result.language, ".en");
  assert.deepEqual(result.languages.map((language) => language.id), ["a.en", ".de", ".en"]);
  assert.equal(result.title, "Me at the zoo");
  assert.equal(result.channel, "jawed");
  assert.equal(result.duration, 19);
  assert.equal(result.segments[0].text, "Hello world & friends.");
  assert.equal(result.segments[1].start, 1.125);
  assert.equal(result.segments[1].duration, 2.25);
  assert.equal(new URL(calls[1].url).searchParams.get("fmt"), "json3");
  assert.ok(calls.every((call) => call.options?.redirect === "error" && call.options?.cache === "no-store" && call.options?.signal));
  assert.ok(!JSON.stringify(result).includes("timedtext"));
  assert.ok(!JSON.stringify(result).includes("baseUrl"));
});

test("chooses exactly the requested existing language and rejects unavailable language", async () => {
  const captionRequests: string[] = [];
  const retrieve = createCaptionRetriever(async (request) => {
    const requested = String(request);
    if (requested.includes("/youtubei/")) return json(player());
    captionRequests.push(requested);
    return json(captionDocument);
  });
  assert.equal((await retrieve(url, ".de")).language, ".de");
  assert.equal(new URL(captionRequests[0]).searchParams.get("lang"), "de");
  await assert.rejects(retrieve(url, "fr"), hasCode("LANGUAGE_UNAVAILABLE"));
  await assert.rejects(retrieve(url, "https://localhost"), hasCode("LANGUAGE_UNAVAILABLE"));
  assert.equal(captionRequests.length, 1);
});

test("falls back to iOS when Android player access is blocked", async () => {
  let playerRequests = 0;
  const retrieve = createCaptionRetriever(async (request, options) => {
    if (String(request).includes("/youtubei/")) {
      playerRequests++;
      const body = JSON.parse(String(options?.body));
      if (playerRequests === 1) {
        assert.equal(body.context.client.clientName, "ANDROID");
        return new Response("Blocked", { status: 429 });
      }
      assert.equal(body.context.client.clientName, "IOS");
      return json(player());
    }
    return json(captionDocument);
  });
  assert.ok((await retrieve(url)).segments.length > 0);
  assert.equal(playerRequests, 2);
});

test("only reports no captions after two valid playable responses with no tracks", async () => {
  let calls = 0;
  const retrieve = createCaptionRetriever(async () => { calls++; return json(player([])); });
  await assert.rejects(retrieve(url), (error: unknown) => {
    assert.ok(error instanceof CaptionError);
    assert.equal(error.code, "NO_CAPTIONS");
    assert.equal(error.message, "This video doesn’t have captions available, so TranscriptGenerator can’t create a transcript.");
    return true;
  });
  assert.equal(calls, 2);
});

test("a block, empty timedtext, malformed player, and restricted video never become no-captions", async () => {
  const cases: [string, typeof fetch][] = [
    ["YOUTUBE_BLOCKED", async () => new Response("Blocked", { status: 403 })],
    ["YOUTUBE_BLOCKED", async (request) => String(request).includes("/youtubei/") ? json(player()) : new Response("")],
    ["YOUTUBE_FAILURE", async () => json({ playabilityStatus: { status: "OK" } })],
    ["YOUTUBE_FAILURE", async () => new Response("<html>Consent required</html>")],
    ["VIDEO_RESTRICTED", async () => json({ playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Confirm your age" } })],
    ["YOUTUBE_BLOCKED", async () => json({ playabilityStatus: { status: "LOGIN_REQUIRED", reason: "Sign in to confirm you’re not a bot" } })],
    ["VIDEO_UNAVAILABLE", async () => json({ playabilityStatus: { status: "ERROR", reason: "This video is unavailable" } })],
  ];
  for (const [code, fetchImpl] of cases) await assert.rejects(createCaptionRetriever(fetchImpl)(url), hasCode(code));
});

test("untrusted caption URLs cannot trigger requests to arbitrary addresses", async () => {
  for (const unsafe of ["http://127.0.0.1/api/timedtext", `https://www.youtube.com.evil.test/api/timedtext?v=${videoId}`, `https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ`, `https://www.youtube.com/redirect?v=${videoId}`]) {
    const requests: string[] = [];
    const retrieve = createCaptionRetriever(async (request) => {
      requests.push(String(request));
      return json(player([{ ...track("en"), baseUrl: unsafe }]));
    });
    await assert.rejects(retrieve(url), hasCode("YOUTUBE_FAILURE"));
    assert.ok(requests.every((request) => request === "https://www.youtube.com/youtubei/v1/player"));
  }
});

test("bounded player bodies and HTTP redirects fail safely", async () => {
  await assert.rejects(createCaptionRetriever(async () => new Response("{}", { headers: { "Content-Length": "999999999" } }))(url), hasCode("YOUTUBE_FAILURE"));
  await assert.rejects(createCaptionRetriever(async () => new Response("x".repeat(2 * 1024 * 1024 + 1)))(url), hasCode("YOUTUBE_FAILURE"));
  await assert.rejects(createCaptionRetriever(async () => new Response(null, { status: 302, headers: { Location: "http://127.0.0.1" } }))(url), hasCode("YOUTUBE_FAILURE"));
});

test("parser ignores styling/newlines, keeps overlaps, orders timestamps, and rejects invalid times", () => {
  assert.deepEqual(parseCaptionSegments({ events: [
    { wsWinStyleId: 0 }, { tStartMs: 0, segs: [{ utf8: "\n" }] },
    { tStartMs: 1000, dDurationMs: 3000, segs: [{ utf8: "Second" }] },
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "First" }] },
  ] }), [{ text: "First", start: 0, duration: 2 }, { text: "Second", start: 1, duration: 3 }]);
  assert.throws(() => parseCaptionSegments({ events: [{ tStartMs: -1, segs: [{ utf8: "Bad" }] }] }), hasCode("YOUTUBE_FAILURE"));
  assert.throws(() => parseCaptionSegments({}), hasCode("YOUTUBE_FAILURE"));
});

test("copy/download formatting preserves content with optional timestamps including long videos", () => {
  const segments = parseCaptionSegments(captionDocument);
  assert.equal(formatTranscript(segments), "Hello world & friends. Another caption.");
  assert.equal(formatTranscript(segments, true), "[00:00] Hello world & friends.\n[00:01] Another caption.");
  assert.equal(formatTimestamp(3661.7), "01:01:01");
  assert.equal(formatTimestamp(61), "01:01");
});
