import { getAccount } from "@/lib/account";
import { ApiError, assertSameOrigin, errorResponse, readJson } from "@/lib/http";
import { CaptionError, retrieveTranscript } from "@/lib/youtube";
import { formatTranscript, transcriptFilename } from "@/lib/transcript-format";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const account = await getAccount();
    if (!account.user) throw new ApiError("AUTH_REQUIRED","Please log in to download transcripts.",401);
    if (!account.isPro) throw new ApiError("PRO_REQUIRED","Transcript downloads are a Pro feature.",403);
    const body = await readJson(request);
    if (typeof body.url !== "string" || (body.language !== undefined && typeof body.language !== "string")) throw new ApiError("INVALID_REQUEST","Please select a transcript first.");
    const result = await retrieveTranscript(body.url,body.language as string|undefined);
    return new Response(`${result.title}\n${result.channel}\nhttps://www.youtube.com/watch?v=${result.videoId}\n\n${formatTranscript(result.segments,body.timestamps===true)}\n`,{headers:{"Content-Type":"text/plain; charset=utf-8","Content-Disposition":`attachment; filename="${transcriptFilename(result.videoId)}"`,"Cache-Control":"private, no-store"}});
  }catch(error){
    if(error instanceof CaptionError) return Response.json({error:error.message,code:error.code},{status:error.status});
    return errorResponse(error);
  }
}
