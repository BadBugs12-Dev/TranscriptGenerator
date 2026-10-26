import assert from "node:assert/strict";
import test from "node:test";
import { retrieveTranscript } from "../lib/youtube";
import { CaptionError } from "../lib/youtube/errors";

// Opt in explicitly: YouTube is external and can rate-limit/cloud-IP-block the
// caller. These checks do not turn an upstream block into a passing fixture.
const live = process.env.RUN_LIVE_YOUTUBE_TESTS === "1";

test("LIVE: public video discovers tracks, retrieves English/German text and timestamped segments", { skip: !live, timeout: 50_000 }, async () => {
  const english = await retrieveTranscript("https://youtu.be/jNQXAC9IVRw", "en");
  assert.equal(english.videoId, "jNQXAC9IVRw");
  assert.ok(english.title && english.channel);
  assert.ok(english.duration && english.duration > 0);
  assert.ok(english.languages.some((language) => language.code === "de"));
  assert.ok(english.segments.length > 0);
  assert.ok(english.segments.some((segment) => /elephant/i.test(segment.text)));
  assert.ok(english.segments.every((segment) => segment.start >= 0 && segment.duration >= 0));
  const german = await retrieveTranscript("https://www.youtube.com/shorts/jNQXAC9IVRw", "de");
  assert.notEqual(german.language, english.language);
  assert.notEqual(german.segments[0].text, english.segments[0].text);
  console.info(JSON.stringify({ videoId: english.videoId, title: english.title, channel: english.channel, duration: english.duration, languages: english.languages, englishSegments: english.segments.length, firstEnglishSegment: english.segments[0], germanSegments: german.segments.length, firstGermanSegment: german.segments[0] }));
});

test("LIVE: a playable public video with no caption tracks returns NO_CAPTIONS", { skip: !live, timeout: 25_000 }, async () => {
  await assert.rejects(retrieveTranscript("https://www.youtube.com/watch?v=hY7m5jjJ9mM"), (error: unknown) => {
    assert.ok(error instanceof CaptionError);
    assert.equal(error.code, "NO_CAPTIONS");
    console.info(JSON.stringify({ videoId: "hY7m5jjJ9mM", code: error.code, message: error.message }));
    return true;
  });
});
