import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth-redirect";
import { requestOrigin } from "@/lib/http";
export async function GET(request:Request) {
  const url = new URL(request.url);
  const token_hash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  if(token_hash && type==="email") {
    const {error} = await (await createClient()).auth.verifyOtp({token_hash,type:"email"});
    if(!error) return NextResponse.redirect(new URL(safeNext(url.searchParams.get("next")),requestOrigin(request)));
  }
  return NextResponse.redirect(new URL("/login?error=confirmation",requestOrigin(request)));
}
