import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth-redirect";
import { requestOrigin } from "@/lib/http";
export async function GET(request:Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if(code) {
    const {error} = await (await createClient()).auth.exchangeCodeForSession(code);
    if(!error) return NextResponse.redirect(new URL(safeNext(url.searchParams.get("next")),requestOrigin(request)));
  }
  return NextResponse.redirect(new URL("/login?error=confirmation",requestOrigin(request)));
}
