import { NextResponse } from "next/server";

import { processSale, processSubscription } from "@/lib/gumroad/process";

export const runtime = "nodejs";

function resourceId(value: unknown) {
  return typeof value === "string" && /^[a-z0-9_=-]{1,256}$/i.test(value) ? value : null;
}

type GumroadPayload = Record<string, unknown>;

function payloadValue(payload: GumroadPayload, key: string) {
  const direct = payload[key];
  if (direct !== undefined && direct !== null) return direct;

  const sale = payload.sale;
  if (sale && typeof sale === "object" && key in sale) {
    return (sale as GumroadPayload)[key];
  }

  const subscription = payload.subscription;
  if (subscription && typeof subscription === "object" && key in subscription) {
    return (subscription as GumroadPayload)[key];
  }

  return null;
}

function parsePayload(raw: string, contentType: string): GumroadPayload {
  if (contentType.includes("application/json") || raw.trimStart().startsWith("{")) {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid Gumroad JSON payload");
    return parsed as GumroadPayload;
  }

  const form = new URLSearchParams(raw);
  return Object.fromEntries(form.entries());
}

function isTrue(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

export async function POST(request: Request) {
  try {
    const length = Number(request.headers.get("content-length"));
    if (Number.isFinite(length) && length > 32_768) return NextResponse.json({ ok: false }, { status: 413 });

    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 32_768) {
          await reader.cancel();
          return NextResponse.json({ ok: false }, { status: 413 });
        }
        chunks.push(value);
      }
    }

    const raw = Buffer.concat(chunks).toString("utf8");
    const payload = parsePayload(raw, request.headers.get("content-type") ?? "");
    const query = new URL(request.url).searchParams;

    const resourceName = String(payloadValue(payload, "resource_name") ?? query.get("resource_name") ?? "sale");
    const saleId = resourceId(payloadValue(payload, "sale_id"))
      ?? (resourceName === "sale" ? resourceId(payloadValue(payload, "id")) : null);
    const subscriptionId = resourceId(payloadValue(payload, "subscription_id"))
      ?? (resourceName.includes("subscription") ? resourceId(payloadValue(payload, "id")) : null);
    const testPing = isTrue(payloadValue(payload, "test"));

    // Gumroad's "Send test ping" uses the most recent sale payload with test=true.
    // Try the full reconciliation when an ID is present, but never fail endpoint
    // validation just because Gumroad's synthetic test payload cannot be fetched
    // through the production API.
    if (testPing) {
      try {
        if (saleId) await processSale(saleId);
        else if (subscriptionId) await processSubscription(subscriptionId);
      } catch (error) {
        console.warn("Gumroad test ping reconciliation skipped", {
          message: error instanceof Error ? error.message : "Unknown error",
          resourceName,
          hasSaleId: Boolean(saleId),
          hasSubscriptionId: Boolean(subscriptionId),
        });
      }
      return NextResponse.json({ ok: true, test: true });
    }

    // Webhooks are unsigned notifications. Never authorize access, refunds, or
    // terminations from their fields; fetch the actual resource using our API token.
    if (["sale", "refund", "dispute", "dispute_won"].includes(resourceName)) {
      if (!saleId) return NextResponse.json({ ok: false }, { status: 400 });
      await processSale(saleId);
    } else if (["cancellation", "subscription_updated", "subscription_ended", "subscription_restarted"].includes(resourceName)) {
      if (!subscriptionId) return NextResponse.json({ ok: false }, { status: 400 });
      await processSubscription(subscriptionId);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Gumroad webhook reconciliation failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
