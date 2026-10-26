import assert from "node:assert/strict";
import test from "node:test";

import { createAccountToken, verifyAccountToken } from "../lib/gumroad/account-token";
import { getSale, getSubscriber, type GumroadSale, type GumroadSubscriber } from "../lib/gumroad/api";
import { addRecurrence, subscriptionAccessEnd, verifiedPayment } from "../lib/gumroad/entitlement";
import { processSale, processSubscription, type GumroadDependencies, type VerifiedEvent } from "../lib/gumroad/process";

const userId = "a0a0a0a0-a0a0-40a0-80a0-a0a0a0a0a0a0";
const otherUserId = "b0b0b0b0-b0b0-40b0-80b0-b0b0b0b0b0b0";
const sale: GumroadSale = {
  id: "sale-1", created_at: "2026-01-31T12:30:00Z", product_id: "product-1",
  product_permalink: "arbvii", product_name: "Pro", email: "buyer@example.com",
  price: 399, currency: "usd", subscription_id: "sub-1", subscription_duration: "monthly",
};
const subscriber: GumroadSubscriber = { id: "sub-1", product_id: "product-1", status: "alive", recurrence: "monthly" };

function fakeDependencies(overrides: Partial<GumroadDependencies> = {}) {
  const events: VerifiedEvent[] = [];
  const deps: GumroadDependencies = {
    sale: async () => ({ ...sale }), subscriber: async () => ({ ...subscriber }),
    paymentOwner: async () => null, subscriptionOwner: async () => userId,
    apply: async event => { events.push(event); }, ...overrides,
  };
  return { deps, events };
}

test("signed checkout tokens reject tampering, extra components, and expiration", () => {
  process.env.GUMROAD_ACCOUNT_TOKEN_SECRET = "test-secret-only";
  const token = createAccountToken(userId);
  assert.equal(verifyAccountToken(token), userId);
  assert.equal(verifyAccountToken(token.replace(userId, otherUserId)), null);
  assert.equal(verifyAccountToken(`${token}.extra`), null);
  assert.equal(verifyAccountToken(token, Number(token.split(".")[1])), null);
  assert.equal(verifyAccountToken(token, Number(token.split(".")[1]) - 7200), null);
  assert.equal(verifyAccountToken("not-a-token"), null);
});

test("billing recurrence clamps month ends and leap years", () => {
  assert.equal(addRecurrence(sale.created_at, "monthly"), "2026-02-28T12:30:00.000Z");
  assert.equal(addRecurrence("2024-02-29T01:02:03Z", "yearly"), "2025-02-28T01:02:03.000Z");
  assert.equal(addRecurrence("2026-07-31T00:00:00Z", "quarterly"), "2026-10-31T00:00:00.000Z");
  assert.throws(() => addRecurrence(sale.created_at, "weekly"));
});

test("a verified free trial grants its actual seven-day period", () => {
  const payment = verifiedPayment({ ...sale, price: 0 }, { ...subscriber, free_trial_ends_at: "2026-02-07T12:30:00Z" });
  assert.equal(payment.status, "trial");
  assert.equal(payment.period_end, "2026-02-07T12:30:00.000Z");
  assert.equal(verifiedPayment(sale, { ...subscriber, free_trial_ends_at: "2026-02-07T12:30:00Z" }).status, "trial");
  assert.equal(verifiedPayment(sale, { ...subscriber, free_trial_ends_at: "2026-01-07T12:30:00Z" }).status, "paid");
});

test("refunds, chargebacks and open disputes come from verified sale flags", () => {
  assert.equal(verifiedPayment({ ...sale, refunded: true }, subscriber).status, "refunded");
  assert.equal(verifiedPayment({ ...sale, chargedback: true }, subscriber).status, "chargeback");
  assert.equal(verifiedPayment({ ...sale, disputed: true }, subscriber).status, "disputed");
  assert.equal(verifiedPayment({ ...sale, disputed: true, dispute_won: true }, subscriber).status, "paid");
  assert.equal(verifiedPayment({ ...sale, access_revoked: true }, subscriber).status, "revoked");
  assert.throws(() => verifiedPayment(sale, { ...subscriber, product_id: "other-product" }));
  assert.throws(() => verifiedPayment({ ...sale, product_permalink: "other" }, subscriber));
});

test("effective cancellation, failure and end boundaries use provider timestamps", () => {
  assert.equal(subscriptionAccessEnd({ ...subscriber, cancelled_at: "2026-02-28T12:30:00Z" }), "2026-02-28T12:30:00.000Z");
  assert.equal(subscriptionAccessEnd({ ...subscriber, ended_at: "2026-02-20T00:00:00Z", failed_at: "2026-02-19T00:00:00Z" }), "2026-02-19T00:00:00.000Z");
  assert.equal(subscriptionAccessEnd(subscriber), null);
  assert.throws(() => subscriptionAccessEnd({ ...subscriber, status: "cancelled" }), /missing its access end/);
});

test("renewal safely maps the verified linked subscription despite expired checkout token", async () => {
  const { deps, events } = fakeDependencies({ sale: async () => ({ ...sale, custom_fields: { "Account Token": "expired" } }) });
  await processSale("sale-1", deps);
  assert.equal(events[0].p_user_id, userId);
  assert.equal(events[0].p_payment?.amount, 3.99);
  assert.equal(events[0].p_payment?.payment_id, "sale-1");
});

test("unlinked initial sale requires a signed account token valid when purchased", async () => {
  const { deps, events } = fakeDependencies({ subscriptionOwner: async () => null });
  await assert.rejects(processSale("sale-1", deps), /Account Token/);
  assert.equal(events.length, 0);
  const purchasedAt = new Date().toISOString();
  const linked = fakeDependencies({
    subscriptionOwner: async () => null,
    sale: async () => ({ ...sale, created_at: purchasedAt, custom_fields: { "Account Token": createAccountToken(userId) } }),
  });
  await processSale("sale-1", linked.deps);
  assert.equal(linked.events[0].p_user_id, userId);
});

test("contradictory existing ownership fails before an entitlement write", async () => {
  const { deps, events } = fakeDependencies({ paymentOwner: async () => otherUserId });
  await assert.rejects(processSale("sale-1", deps), /Conflicting/);
  assert.equal(events.length, 0);
});

test("sale replay forwards the currently verified subscription end cap", async () => {
  const { deps, events } = fakeDependencies({ subscriber: async () => ({ ...subscriber, status: "cancelled", cancelled_at: "2026-02-28T12:30:00Z" }) });
  await processSale("sale-1", deps);
  assert.equal(events[0].p_access_ends_at, "2026-02-28T12:30:00.000Z");
});

test("subscription notification cannot end an active subscription by its event name", async () => {
  const { deps, events } = fakeDependencies();
  await processSubscription("sub-1", deps);
  assert.equal(events[0].p_access_ends_at, null);
  assert.equal(events[0].p_payment, null);
});

test("unlinked lifecycle events cannot establish account ownership", async () => {
  const { deps, events } = fakeDependencies({ subscriptionOwner: async () => null });
  await processSubscription("sub-1", deps);
  assert.equal(events.length, 0);
});

test("Gumroad API accepts documented plural subscriber envelope and verifies resource ID", async () => {
  const originalFetch = global.fetch;
  process.env.GUMROAD_ACCESS_TOKEN = "test-api-token-only";
  try {
    global.fetch = async () => Response.json({ success: true, subscribers: subscriber });
    assert.deepEqual(await getSubscriber("sub-1"), subscriber);
    await assert.rejects(getSubscriber("wrong-id"), /Unexpected/);
    global.fetch = async () => Response.json({ success: false, sale });
    await assert.rejects(getSale("sale-1"), /request failed/);
    global.fetch = async () => Response.json({ success: true, sale });
    await assert.rejects(getSale("wrong-id"), /Unexpected/);
  } finally { global.fetch = originalFetch; }
});
