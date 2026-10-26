import "server-only";

import type { GumroadSale, GumroadSubscriber } from "./api";

export const PRODUCT_PERMALINK = "arbvii";
export const ACCOUNT_TOKEN_FIELD = "Account Token";

export function validIso(value: string, label = "Gumroad timestamp") {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`Invalid ${label}`);
  return new Date(timestamp).toISOString();
}

export function addRecurrence(startIso: string, recurrence?: string | null) {
  const date = new Date(validIso(startIso));
  const months: Record<string, number> = { monthly: 1, quarterly: 3, biannually: 6, yearly: 12, every_two_years: 24 };
  const count = recurrence ? months[recurrence] : undefined;
  if (!count) throw new Error(`Unsupported Gumroad recurrence: ${recurrence ?? "missing"}`);
  // Clamp month-end dates: Jan 31 renews in February, rather than overflowing into March.
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + count);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString();
}

export function subscriptionAccessEnd(subscriber: GumroadSubscriber) {
  const dates = [subscriber.ended_at, subscriber.failed_at, subscriber.cancelled_at]
    .filter((value): value is string => Boolean(value))
    .map(value => validIso(value));
  if (!dates.length && ["cancelled", "failed_payment", "fixed_subscription_period_ended"].includes(subscriber.status)) {
    throw new Error("Terminated Gumroad subscription is missing its access end");
  }
  return dates.length ? dates.sort((a, b) => Date.parse(a) - Date.parse(b))[0] : null;
}

export function verifiedPayment(sale: GumroadSale, subscriber: GumroadSubscriber) {
  if (sale.product_permalink !== PRODUCT_PERMALINK) throw new Error("Wrong Gumroad product");
  if (!sale.subscription_id || subscriber.id !== sale.subscription_id || !sale.product_id || subscriber.product_id !== sale.product_id) {
    throw new Error("Gumroad subscription does not match the sale");
  }
  const purchasedAt = validIso(sale.created_at, "Gumroad sale timestamp");
  if (!Number.isSafeInteger(sale.price) || sale.price < 0 || !/^[a-z]{3}$/i.test(sale.currency)) throw new Error("Invalid Gumroad sale amount");
  let periodEnd = addRecurrence(purchasedAt, sale.subscription_duration ?? sale.recurrence ?? subscriber.recurrence);
  const trialEnd = subscriber.free_trial_ends_at ? validIso(subscriber.free_trial_ends_at, "Gumroad trial end") : null;
  const isTrial = trialEnd !== null && Date.parse(trialEnd) > Date.parse(purchasedAt);
  if (isTrial) periodEnd = trialEnd;
  const status = sale.refunded ? "refunded"
    : sale.chargedback || sale.chargebacked ? "chargeback"
    : sale.disputed && !sale.dispute_won ? "disputed"
    : sale.access_revoked ? "revoked"
    : isTrial ? "trial" : "paid";
  return {
    payment_id: sale.id,
    amount: sale.price / 100,
    currency: sale.currency.toUpperCase(),
    status,
    purchased_at: purchasedAt,
    period_start: purchasedAt,
    period_end: periodEnd,
  };
}
