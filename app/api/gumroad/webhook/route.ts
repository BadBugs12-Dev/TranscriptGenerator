import { NextResponse } from "next/server";

import { processSale, processSubscription } from "@/lib/gumroad/process";

export const runtime = "nodejs";

function resourceId(value: string | null) {
  return value && /^[a-z0-9_=-]{1,256}$/i.test(value) ? value : null;
}

export async function POST(request: Request) {
  try {
    const length = Number(request.headers.get("content-length"));
    if (length > 32_768) return NextResponse.json({ ok: false }, { status: 413 });
    const reader = request.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 32_768) { await reader.cancel(); return NextResponse.json({ ok: false }, { status: 413 }); }
        chunks.push(value);
      }
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    const form = new URLSearchParams(raw);
    const resourceName = form.get("resource_name") ?? new URL(request.url).searchParams.get("resource_name") ?? "sale";
    const saleId = resourceId(form.get("sale_id"));
    const subscriptionId = resourceId(form.get("subscription_id"));

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
  } catch {
    console.error("Gumroad webhook reconciliation failed");
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
