export type TranscriptSegment = {
  text: string;
  /** Seconds from the start of the video. */
  start: number;
  /** Seconds that the caption remains visible; captions may overlap. */
  duration: number;
};

export type CaptionLanguage = { id: string; label: string; code: string };

export type TranscriptResult = {
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  duration: number | null;
  languages: CaptionLanguage[];
  /** The selected track's id, suitable for a subsequent language request. */
  language: string;
  segments: TranscriptSegment[];
};
