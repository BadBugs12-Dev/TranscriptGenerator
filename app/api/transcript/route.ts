import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAccount } from "@/lib/account";
import { hasSupabaseConfig } from "@/lib/config";
import { ApiError, assertSameOrigin, errorResponse, readJson } from "@/lib/http";
import { assertSigningConfigured, signState, verifyState } from "@/lib/signed-state";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { belowFreeLimits } from "@/lib/usage-policy";
import { CaptionError, parseYouTubeUrl, retrieveTranscript } from "@/lib/youtube";
export const runtime = "nodejs";
export const maxDuration = 60;
const TRIAL_COOKIE = "tg_trial";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readJson(request);
    if (typeof body.url !== "string") throw new ApiError("INVALID_URL","Paste a valid YouTube URL.");
    const {videoId,url} = parseYouTubeUrl(body.url);
    // Fail before any retrieval/usage commit if response signing cannot succeed.
    assertSigningConfigured();
    if (body.language !== undefined && (typeof body.language !== "string" || body.language.length > 100)) throw new ApiError("INVALID_LANGUAGE","Choose an available caption language.");
    if (!hasSupabaseConfig()) throw new ApiError("UNAVAILABLE","The service is being configured. Please try again shortly.",503);
    const account = await getAccount();
    const jar = await cookies();
    const trial = verifyState(jar.get(TRIAL_COOKIE)?.value,"trial");
    const owner = account.user ? `user:${account.user.id}` : trial?.owner ?? `guest:${randomUUID()}`;
    const receipt = verifyState(body.receipt,"transcript");
    const sameTranscript = receipt?.owner === owner && receipt.videoId === videoId;
    if (!sameTranscript) {
      if (!account.user && trial) throw new ApiError("AUTH_REQUIRED","You’ve used your free trial. Create an account for 3 transcripts per day and 15 per month.",401);
      if (account.user && !account.isPro && !belowFreeLimits(account.today,account.month)) throw new ApiError("FREE_LIMIT_REACHED","You’ve reached your Free limit. Upgrade to Pro for unlimited transcripts.",429);
    }
    const result = await retrieveTranscript(url,body.language as string|undefined);
    let isPro = account.isPro;
    if (account.user && !sameTranscript) {
      // Commit usage only after usable captions exist; the database rechecks quota atomically.
      const {data,error} = await createSupabaseAdmin().rpc("record_transcript_success",{p_user_id:account.user.id,p_video_id:videoId});
      if (error) throw error;
      if (!data?.allowed) throw new ApiError("FREE_LIMIT_REACHED","You’ve reached your Free limit. Upgrade to Pro for unlimited transcripts.",429);
      isPro = data.is_pro;
    }
    const response = NextResponse.json({result,isPro,receipt:signState({purpose:"transcript",owner,videoId,expires:Date.now()+30*60*1000})},{headers:{"Cache-Control":"private, no-store"}});
    if (!account.user && !trial) response.cookies.set(TRIAL_COOKIE,signState({purpose:"trial",owner,expires:Date.now()+365*86400000}),{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"lax",path:"/",maxAge:365*86400});
    return response;
  } catch(error) {
    if (error instanceof CaptionError) {
      if (error.code.startsWith("YOUTUBE_")) console.warn("YouTube caption retrieval failed",{code:error.code});
      return NextResponse.json({error:error.message,code:error.code},{status:error.status,headers:{"Cache-Control":"private, no-store"}});
    }
    return errorResponse(error);
  }
}
