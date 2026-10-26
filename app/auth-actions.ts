"use server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth-redirect";
import { hasSupabaseConfig } from "@/lib/config";
export type AuthState = {error?:string;message?:string};
export async function authenticate(mode:"login"|"signup", previous:AuthState, form:FormData):Promise<AuthState> {
  const email = String(form.get("email")??"").trim();
  const password = String(form.get("password")??"");
  const next = safeNext(form.get("next"));
  if (!hasSupabaseConfig()) return {error:"Account access is being configured. Please try again shortly."};
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 128) return {error:"Enter a valid email and a password between 8 and 128 characters."};
  try {
    const client = await createClient();
    if (mode==="login") {
      const {error} = await client.auth.signInWithPassword({email,password});
      if (error) return {error:"We couldn’t log you in. Check your email, password, and email confirmation, then try again."};
    } else {
      const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
      if (!siteUrl) return {error:"Signup is being configured. Please try again shortly."};
      const callback = new URL("/auth/callback",siteUrl);
      callback.searchParams.set("next",next);
      const {data,error} = await client.auth.signUp({email,password,options:{emailRedirectTo:callback.toString()}});
      if (error) return {error:"We couldn’t create your account. Please try again later or log in if you already have an account."};
      if (!data.session) return {message:"Check your email to confirm your account. Then come back and log in."};
    }
  } catch(error) {
    console.error("Authentication unavailable", error instanceof Error ? error.name : "unknown");
    return {error:"Account access is unavailable right now. Please try again shortly."};
  }
  redirect(next);
}
