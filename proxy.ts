import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseConfig } from "@/lib/config";
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({request});
  response.headers.set("Cache-Control", "private, no-store");
  if (!hasSupabaseConfig()) return response;
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values, headers) {
        values.forEach(({name,value}) => request.cookies.set(name,value));
        response = NextResponse.next({request});
        values.forEach(({name,value,options}) => response.cookies.set(name,value,options));
        Object.entries(headers).forEach(([key,value]) => response.headers.set(key,value));
        response.headers.set("Cache-Control","private, no-store");
      }
    }
  });
  await supabase.auth.getClaims();
  return response;
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|api/gumroad/webhook|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"] };
