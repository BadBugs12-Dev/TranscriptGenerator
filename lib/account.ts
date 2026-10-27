import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { hasSupabaseConfig } from "@/lib/config";
import { isProEntitlement, usageBoundaries } from "@/lib/usage-policy";
export type Account = {
  user: { id: string; email?: string } | null;
  isPro: boolean; expiresAt: string | null; subscriptionId: string | null;
  today: number; month: number;
};
export const getAccount = cache(async (): Promise<Account> => {
  const empty: Account = {user:null,isPro:false,expiresAt:null,subscriptionId:null,today:0,month:0};
  if (!hasSupabaseConfig()) return empty;
  const client = await createClient();
  const {data:{user}, error} = await client.auth.getUser();
  if (!user) {
    if (error && error.name !== "AuthSessionMissingError" && error.status !== 401 && error.status !== 403) throw error;
    return empty;
  }
  const boundary = usageBoundaries();
  const [profile, today, month] = await Promise.all([
    client.from("profiles").select("pro_expires_at,gumroad_subscription_id").eq("user_id",user.id).single(),
    client.from("transcript_usage").select("id",{head:true,count:"exact"}).eq("user_id",user.id).gte("created_at",boundary.day),
    client.from("transcript_usage").select("id",{head:true,count:"exact"}).eq("user_id",user.id).gte("created_at",boundary.month),
  ]);
  if (profile.error || today.error || month.error) throw profile.error || today.error || month.error;
  return {user:{id:user.id,email:user.email},isPro:isProEntitlement(profile.data.pro_expires_at),expiresAt:profile.data.pro_expires_at,subscriptionId:profile.data.gumroad_subscription_id,today:today.count??0,month:month.count??0};
});
