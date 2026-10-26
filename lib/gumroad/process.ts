import "server-only";

import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyAccountToken } from "./account-token";
import { getSale, getSubscriber, type GumroadSale, type GumroadSubscriber } from "./api";
import { ACCOUNT_TOKEN_FIELD, PRODUCT_PERMALINK, subscriptionAccessEnd, verifiedPayment } from "./entitlement";

type Payment = ReturnType<typeof verifiedPayment>;
export type VerifiedEvent = {
  p_user_id: string;
  p_subscription_id: string;
  p_verified_at: string;
  p_access_ends_at: string | null;
  p_payment: Payment | null;
};
export type GumroadDependencies = {
  sale(id: string): Promise<GumroadSale>;
  subscriber(id: string): Promise<GumroadSubscriber>;
  paymentOwner(id: string): Promise<string | null>;
  subscriptionOwner(id: string): Promise<string | null>;
  apply(event: VerifiedEvent): Promise<void>;
};

function dependencies(): GumroadDependencies {
  const supabase = createSupabaseAdmin();
  return {
    sale: getSale,
    subscriber: getSubscriber,
    async paymentOwner(id) {
      const { data, error } = await supabase.from("payments").select("user_id").eq("payment_provider", "gumroad").eq("payment_id", id).maybeSingle();
      if (error) throw error;
      return data?.user_id ?? null;
    },
    async subscriptionOwner(id) {
      const { data, error } = await supabase.from("profiles").select("user_id").eq("gumroad_subscription_id", id).maybeSingle();
      if (error) throw error;
      return data?.user_id ?? null;
    },
    async apply(event) {
      const { error } = await supabase.rpc("apply_verified_gumroad_event", event);
      if (error) throw error;
    },
  };
}

export async function processSale(saleId: string, deps = dependencies()) {
  const verifiedAt = new Date().toISOString();
  const sale = await deps.sale(saleId);
  if (sale.id !== saleId || sale.product_permalink !== PRODUCT_PERMALINK) throw new Error("Wrong Gumroad sale or product");
  if (!sale.subscription_id) throw new Error("Expected a Gumroad membership sale");
  const subscriber = await deps.subscriber(sale.subscription_id);
  const payment = verifiedPayment(sale, subscriber);
  const [paymentOwner, subscriptionOwner] = await Promise.all([
    deps.paymentOwner(sale.id), deps.subscriptionOwner(sale.subscription_id),
  ]);
  if (paymentOwner && subscriptionOwner && paymentOwner !== subscriptionOwner) throw new Error("Conflicting Gumroad account linkage");

  // Recurring charges retain the original checkout token. Once linked, use the
  // provider-verified subscription ID; a renewal must not require a fresh token.
  let userId = paymentOwner ?? subscriptionOwner;
  if (!userId) {
    const token = sale.custom_fields?.[ACCOUNT_TOKEN_FIELD];
    userId = token ? verifyAccountToken(token, Math.floor(Date.parse(sale.created_at) / 1000)) : null;
  }
  if (!userId) throw new Error("Invalid or missing Account Token");
  await deps.apply({
    p_user_id: userId,
    p_subscription_id: sale.subscription_id,
    p_verified_at: verifiedAt,
    p_access_ends_at: subscriptionAccessEnd(subscriber),
    p_payment: payment,
  });
}

export async function processSubscription(subscriptionId: string, deps = dependencies()) {
  const verifiedAt = new Date().toISOString();
  const subscriber = await deps.subscriber(subscriptionId);
  if (subscriber.id !== subscriptionId) throw new Error("Wrong Gumroad subscription");
  const userId = await deps.subscriptionOwner(subscriptionId);
  if (!userId) return; // The initial verified sale establishes account ownership.
  await deps.apply({
    p_user_id: userId,
    p_subscription_id: subscriptionId,
    p_verified_at: verifiedAt,
    p_access_ends_at: subscriptionAccessEnd(subscriber),
    p_payment: null,
  });
}
