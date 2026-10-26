import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError, errorResponse, readJson } from "@/lib/http";
import { CaptionError } from "@/lib/youtube/errors";
import { retrieveTranscript } from "@/lib/youtube/retrieve";

export const runtime = "nodejs";
export const maxDuration = 60;

function authorize(request: Request) {
  const secret = process.env.CAPTION_SERVICE_SECRET;
  if (!secret || secret.length < 32) {
    throw new ApiError("UNAVAILABLE", "Caption service is not configured.", 503);
  }
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) throw new ApiError("FORBIDDEN", "Forbidden.", 403);
  const provided = header.slice(7);
  const expectedBuffer = Buffer.from(secret);
  const providedBuffer = Buffer.from(provided);
  if (expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    throw new ApiError("FORBIDDEN", "Forbidden.", 403);
  }
}

export async function POST(request: Request) {
  try {
    authorize(request);
    const body = await readJson(request);
    if (typeof body.url !== "string") throw new ApiError("INVALID_URL", "Paste a valid YouTube URL.");
    if (body.language !== undefined && (typeof body.language !== "string" || body.language.length > 100)) {
      throw new ApiError("INVALID_LANGUAGE", "Choose an available caption language.");
    }
    const result = await retrieveTranscript(body.url, body.language as string | undefined);
    return NextResponse.json({ result }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CaptionError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    return errorResponse(error);
  }
}
