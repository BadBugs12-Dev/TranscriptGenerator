import { NextResponse } from "next/server";

import { createAccountToken } from "@/lib/gumroad/account-token";
import { createClient } from "@/lib/supabase/server";
import { ApiError, assertSameOrigin, errorResponse, readJson } from "@/lib/http";

const PRODUCT_URL = "https://scpforever.gumroad.com/l/arbvii";

type Tier = "regular" | "support";
type Recurrence = "monthly" | "yearly";

const TIER_NAMES: Record<Tier, string> = {
  regular: "Pro Transcription Plan",
  support: "Support Me Pro Tier!",
};

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw new ApiError("UNAUTHORIZED", "Please sign in before upgrading.", 401);
    const body = await readJson(request);
    if (body.tier !== "regular" && body.tier !== "support") throw new ApiError("INVALID_TIER", "Choose a valid membership tier.");
    if (body.recurrence !== "monthly" && body.recurrence !== "yearly") throw new ApiError("INVALID_RECURRENCE", "Choose monthly or yearly billing.");
    const tier: Tier = body.tier;
    const recurrence: Recurrence = body.recurrence;

    const accountToken = createAccountToken(data.user.id);
    const url = new URL(PRODUCT_URL);

    url.searchParams.set("wanted", "true");
    url.searchParams.set("variant", TIER_NAMES[tier]);
    url.searchParams.set(recurrence, "true");
    url.searchParams.set("Account Token", accountToken);
    if (data.user.email) url.searchParams.set("email", data.user.email);

    return NextResponse.json({ checkoutUrl: url.toString() }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
