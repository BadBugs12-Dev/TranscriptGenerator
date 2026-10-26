import assert from "node:assert/strict";
import { CaptionError, retrieveTranscript } from "../lib/youtube";

async function main() {
  const english = await retrieveTranscript("https://youtu.be/jNQXAC9IVRw", "en");
  assert.equal(english.videoId, "jNQXAC9IVRw");
  assert.ok(english.title && english.channel && english.duration);
  assert.ok(english.languages.some((language) => language.code === "de"));
  assert.ok(english.segments.length && english.segments.some((segment) => /elephant/i.test(segment.text)));
  assert.ok(english.segments.every((segment) => segment.start >= 0 && segment.duration >= 0));
  const german = await retrieveTranscript("https://www.youtube.com/shorts/jNQXAC9IVRw", "de");
  assert.notEqual(german.language, english.language);
  assert.ok(german.segments.length);
  assert.notEqual(german.segments[0].text, english.segments[0].text);
  console.info(JSON.stringify({ checkedAt: new Date().toISOString(), videoId: english.videoId, title: english.title, channel: english.channel, duration: english.duration, languages: english.languages, englishSegments: english.segments.length, firstEnglishSegment: english.segments[0], germanSegments: german.segments.length, firstGermanSegment: german.segments[0] }));
  await assert.rejects(retrieveTranscript("https://www.youtube.com/watch?v=hY7m5jjJ9mM"), (error: unknown) => {
    assert.ok(error instanceof CaptionError);
    assert.equal(error.code, "NO_CAPTIONS");
    console.info(JSON.stringify({ videoId: "hY7m5jjJ9mM", code: error.code, message: error.message }));
    return true;
  });
  console.info("Live public captions, language selection, timestamps, and no-captions checks passed.");
}

main().catch((error: unknown) => {
  if (error instanceof CaptionError) console.error(`${error.code}: ${error.message}`);
  else console.error(error instanceof Error ? error.message : "Live caption verification failed.");
  process.exitCode = 1;
});
