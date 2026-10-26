import type { TranscriptSegment } from "./youtube/types";

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  const pair = (value: number) => String(value).padStart(2, "0");
  return hours ? `${pair(hours)}:${pair(minutes)}:${pair(remainder)}` : `${pair(minutes)}:${pair(remainder)}`;
}

export function formatTranscript(segments: TranscriptSegment[], timestamps = false): string {
  if (timestamps) return segments.map((segment) => `[${formatTimestamp(segment.start)}] ${segment.text}`).join("\n");
  // Caption boundaries are presentation timing, not sentence/paragraph boundaries.
  // Group the clean text into readable paragraphs without rewriting its content.
  const paragraphs: string[] = [];
  let paragraph = "";
  for (const segment of segments) {
    paragraph += `${paragraph ? " " : ""}${segment.text.trim()}`;
    if (paragraph.length >= 650 && /[.!?。！？]["'”’)]?$/.test(paragraph)) {
      paragraphs.push(paragraph);
      paragraph = "";
    }
  }
  if (paragraph) paragraphs.push(paragraph);
  return paragraphs.join("\n\n");
}

export function transcriptFilename(videoId: string): string {
  return `transcript-${videoId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 11)}.txt`;
}
