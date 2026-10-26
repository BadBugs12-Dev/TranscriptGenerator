export type CaptionErrorCode =
  | "INVALID_URL"
  | "VIDEO_UNAVAILABLE"
  | "VIDEO_RESTRICTED"
  | "NO_CAPTIONS"
  | "LANGUAGE_UNAVAILABLE"
  | "YOUTUBE_BLOCKED"
  | "YOUTUBE_TIMEOUT"
  | "YOUTUBE_FAILURE";

const errors: Record<CaptionErrorCode, { status: number; message: string }> = {
  INVALID_URL: { status: 400, message: "Enter a valid YouTube watch, Shorts, or youtu.be URL." },
  VIDEO_UNAVAILABLE: { status: 404, message: "This video is unavailable, deleted, or private." },
  VIDEO_RESTRICTED: { status: 422, message: "Captions cannot be retrieved for this age-restricted, region-restricted, or otherwise restricted video." },
  NO_CAPTIONS: { status: 422, message: "This video doesn’t have captions available, so TranscriptGenerator can’t create a transcript." },
  LANGUAGE_UNAVAILABLE: { status: 400, message: "That caption language is unavailable. Choose one of the video's available languages." },
  YOUTUBE_BLOCKED: { status: 503, message: "YouTube is temporarily blocking caption requests. Please try again later." },
  YOUTUBE_TIMEOUT: { status: 504, message: "YouTube took too long to respond. Please try again." },
  YOUTUBE_FAILURE: { status: 502, message: "We couldn't retrieve captions from YouTube. Please try again later." },
};

/** Only these fixed messages, never raw upstream errors, may be sent to clients. */
export class CaptionError extends Error {
  readonly code: CaptionErrorCode;
  readonly status: number;

  constructor(code: CaptionErrorCode) {
    super(errors[code].message);
    this.name = "CaptionError";
    this.code = code;
    this.status = errors[code].status;
  }
}
