import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assertSameOrigin, errorResponse, requestOrigin } from "@/lib/http";
export async function POST(request:Request) {
  try {
    assertSameOrigin(request);
    const {error} = await (await createClient()).auth.signOut();
    if(error) throw error;
    return NextResponse.redirect(new URL("/",requestOrigin(request)),303);
  } catch(error){return errorResponse(error);}
}
