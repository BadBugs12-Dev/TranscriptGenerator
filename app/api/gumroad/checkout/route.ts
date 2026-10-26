import { NextResponse } from "next/server";

import { createAccountToken } from "@/lib/gumroad/account-token";
import { createSupabaseAdmin } from "@/lib/supabase/admin";

const PRODUCT_URL = "https://scpforever.gumroad.com/l/arbvii";

type Tier = "regular" | "support";
type Recurrence = "monthly" | "yearly";

const TIER_NAMES: Record<Tier, string> = {
  regular: "Pro Transcription Plan",
  support: "Support Me Pro Tier!",
};

export async function POST(request: Request) {
  try {
    const authorization = request.headers.get("authorization");
    const accessToken = authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
    if (!accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json()) as { tier?: Tier; recurrence?: Recurrence };
    const tier: Tier = body.tier === "support" ? "support" : "regular";
    const recurrence: Recurrence = body.recurrence === "yearly" ? "yearly" : "monthly";

    const accountToken = createAccountToken(data.user.id);
    const url = new URL(PRODUCT_URL);

    url.searchParams.set("wanted", "true");
    url.searchParams.set("variant", TIER_NAMES[tier]);
    url.searchParams.set(recurrence, "true");
    url.searchParams.set("Account Token", accountToken);
    if (data.user.email) url.searchParams.set("email", data.user.email);

    return NextResponse.json({ checkoutUrl: url.toString() });
  } catch (error) {
    console.error("Failed to create Gumroad checkout URL", error);
    return NextResponse.json({ error: "Checkout unavailable" }, { status: 500 });
  }
}
