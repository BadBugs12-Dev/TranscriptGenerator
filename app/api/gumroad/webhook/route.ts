import { NextResponse } from "next/server";

import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getSale, getSubscriber } from "@/lib/gumroad/api";
import { verifyAccountToken } from "@/lib/gumroad/account-token";

const PRODUCT_PERMALINK = "arbvii";
const ACCOUNT_TOKEN_FIELD = "Account Token";

function addRecurrence(startIso: string, recurrence?: string | null) {
  const date = new Date(startIso);
  if (Number.isNaN(date.getTime())) throw new Error("Invalid Gumroad sale timestamp");

  switch (recurrence) {
    case "monthly":
      date.setUTCMonth(date.getUTCMonth() + 1);
      break;
    case "quarterly":
      date.setUTCMonth(date.getUTCMonth() + 3);
      break;
    case "biannually":
      date.setUTCMonth(date.getUTCMonth() + 6);
      break;
    case "yearly":
      date.setUTCFullYear(date.getUTCFullYear() + 1);
      break;
    case "every_two_years":
      date.setUTCFullYear(date.getUTCFullYear() + 2);
      break;
    default:
      throw new Error(`Unsupported Gumroad recurrence: ${recurrence ?? "missing"}`);
  }

  return date.toISOString();
}

function latestIso(a: string | null | undefined, b: string) {
  if (!a) return b;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

async function handleSale(saleId: string) {
  const sale = await getSale(saleId);
  if (sale.product_permalink !== PRODUCT_PERMALINK) throw new Error("Wrong Gumroad product");

  const accountToken = sale.custom_fields?.[ACCOUNT_TOKEN_FIELD];
  if (!accountToken) throw new Error("Missing Account Token custom field");

  const saleTime = Math.floor(new Date(sale.created_at).getTime() / 1000);
  if (!Number.isFinite(saleTime)) throw new Error("Invalid Gumroad sale timestamp");

  const userId = verifyAccountToken(accountToken, saleTime);
  if (!userId) throw new Error("Invalid Account Token");

  const supabase = createSupabaseAdmin();
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("user_id, pro_expires_at, gumroad_subscription_id")
    .eq("user_id", userId)
    .single();

  if (profileError || !profile) throw new Error("Linked Supabase profile not found");

  let periodEnd = addRecurrence(sale.created_at, sale.subscription_duration ?? sale.recurrence);

  if (sale.subscription_id) {
    const subscriber = await getSubscriber(sale.subscription_id);
    if (subscriber.free_trial_ends_at && new Date(subscriber.free_trial_ends_at).getTime() > new Date(sale.created_at).getTime()) {
      periodEnd = subscriber.free_trial_ends_at;
    }
  }

  const badStanding = Boolean(sale.refunded || sale.disputed || sale.chargedback);
  const paymentStatus = sale.refunded ? "refunded" : sale.disputed ? "disputed" : sale.chargedback ? "chargeback" : "paid";

  const { error: paymentError } = await supabase.from("payments").upsert(
    {
      user_id: userId,
      payment_provider: "gumroad",
      payment_id: sale.id,
      amount: sale.price / 100,
      currency: (sale.currency || "USD").toUpperCase(),
      status: paymentStatus,
      purchased_at: sale.created_at,
      period_start: sale.created_at,
      period_end: periodEnd,
    },
    { onConflict: "payment_id" },
  );

  if (paymentError) throw paymentError;

  if (badStanding) {
    if (sale.subscription_id) {
      const subscriber = await getSubscriber(sale.subscription_id);
      if (subscriber.ended_at) {
        const { error } = await supabase
          .from("profiles")
          .update({ pro_expires_at: subscriber.ended_at, gumroad_subscription_id: sale.subscription_id })
          .eq("user_id", userId);
        if (error) throw error;
      }
    }
    return;
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update({
      pro_expires_at: latestIso(profile.pro_expires_at, periodEnd),
      gumroad_subscription_id: sale.subscription_id ?? profile.gumroad_subscription_id,
    })
    .eq("user_id", userId);

  if (updateError) throw updateError;
}

async function handleRefund(saleId: string) {
  const sale = await getSale(saleId);
  if (sale.product_permalink !== PRODUCT_PERMALINK) return;

  const supabase = createSupabaseAdmin();
  await supabase.from("payments").update({ status: "refunded" }).eq("payment_id", sale.id);

  if (!sale.subscription_id) return;
  const subscriber = await getSubscriber(sale.subscription_id);
  if (!subscriber.ended_at) return;

  await supabase
    .from("profiles")
    .update({ pro_expires_at: subscriber.ended_at })
    .eq("gumroad_subscription_id", sale.subscription_id);
}

async function handleSubscriptionEnded(subscriptionId: string) {
  const subscriber = await getSubscriber(subscriptionId);
  if (!subscriber.ended_at) throw new Error("Gumroad subscription is not actually ended");

  const supabase = createSupabaseAdmin();
  const { error } = await supabase
    .from("profiles")
    .update({ pro_expires_at: subscriber.ended_at })
    .eq("gumroad_subscription_id", subscriptionId);

  if (error) throw error;
}

async function handleSubscriptionRestarted(subscriptionId: string) {
  const subscriber = await getSubscriber(subscriptionId);
  if (!subscriber.free_trial_ends_at || new Date(subscriber.free_trial_ends_at).getTime() <= Date.now()) return;

  const supabase = createSupabaseAdmin();
  const { data: profile } = await supabase
    .from("profiles")
    .select("user_id, pro_expires_at")
    .eq("gumroad_subscription_id", subscriptionId)
    .single();

  if (!profile) return;

  await supabase
    .from("profiles")
    .update({ pro_expires_at: latestIso(profile.pro_expires_at, subscriber.free_trial_ends_at) })
    .eq("user_id", profile.user_id);
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const resourceName = String(form.get("resource_name") ?? "sale");
    const saleId = String(form.get("sale_id") ?? "");
    const subscriptionId = String(form.get("subscription_id") ?? "");

    if (resourceName === "sale") {
      if (!saleId) throw new Error("Missing sale_id");
      await handleSale(saleId);
    } else if (resourceName === "refund") {
      if (!saleId) throw new Error("Missing sale_id");
      await handleRefund(saleId);
    } else if (resourceName === "subscription_ended") {
      if (!subscriptionId) throw new Error("Missing subscription_id");
      await handleSubscriptionEnded(subscriptionId);
    } else if (resourceName === "subscription_restarted") {
      if (!subscriptionId) throw new Error("Missing subscription_id");
      await handleSubscriptionRestarted(subscriptionId);
    } else if (resourceName === "cancellation" || resourceName === "subscription_updated") {
      // Cancellation does not mean access has ended. Gumroad sends subscription_ended
      // when the paid/trial access period actually finishes.
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Gumroad webhook failed", error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
