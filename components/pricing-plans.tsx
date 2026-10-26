"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons";

type Tier = "regular" | "support";

export function PricingPlans({ signedIn, isPro }: { signedIn: boolean; isPro: boolean }) {
  const router = useRouter();
  const [recurrence, setRecurrence] = useState<"monthly" | "yearly">("monthly");
  const [pending, setPending] = useState<Tier | null>(null);
  const [error, setError] = useState("");

  async function checkout(tier: Tier) {
    if (pending) return;
    setError("");
    setPending(tier);
    try {
      const response = await fetch("/api/gumroad/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tier, recurrence }) });
      if (response.status === 401) { router.push("/login?next=/pricing"); return; }
      const data = await response.json();
      if (!response.ok || !data.checkoutUrl) { setError(data.error || "Checkout isn’t available right now. Please try again shortly."); setPending(null); return; }
      window.location.assign(data.checkoutUrl);
    } catch { setError("We couldn’t connect to checkout. Please try again."); setPending(null); }
  }

  function paidAction(tier: Tier) {
    if (isPro) return <Link href="/dashboard" className={`button button-full ${tier === "regular" ? "button-primary" : "button-secondary"}`}>Manage your Pro <Icon name="arrow" size={17} /></Link>;
    if (!signedIn) return <Link href="/login?next=/pricing" className={`button button-full ${tier === "regular" ? "button-primary" : "button-secondary"}`}>Start your free trial <Icon name="arrow" size={17} /></Link>;
    return <button className={`button button-full ${tier === "regular" ? "button-primary" : "button-secondary"}`} onClick={() => void checkout(tier)} disabled={pending !== null}>{pending === tier ? <><span className="spinner" /> Opening checkout…</> : <>Start your free trial <Icon name="arrow" size={17} /></>}</button>;
  }

  return <>
    <div className="billing-switch" aria-label="Billing period"><button aria-pressed={recurrence === "monthly"} onClick={() => setRecurrence("monthly")} disabled={pending !== null}>Monthly</button><button aria-pressed={recurrence === "yearly"} onClick={() => setRecurrence("yearly")} disabled={pending !== null}>Yearly <span>Save more</span></button></div>
    <div className="pricing-grid">
      <section className="price-card">
        <span className="plan-label">THE EVERYDAY ESSENTIALS</span><h2>Free</h2><p className="plan-description">A few videos. A lot to take away.</p>
        <div className="price"><span>$0</span><span className="price-period">/ forever</span></div>
        <Link href={signedIn ? "/dashboard" : "/signup"} className="button button-secondary button-full">{signedIn ? "Go to your dashboard" : "Create a free account"}<Icon name="arrow" size={17} /></Link>
        <div className="plan-divider" /><ul className="plan-features"><li><Icon name="check" size={17} />3 transcripts per day</li><li><Icon name="check" size={17} />15 transcripts per month</li><li><Icon name="check" size={17} />Read and copy transcripts</li><li><Icon name="check" size={17} />Languages and timestamps</li></ul>
      </section>
      <section className="price-card featured-plan"><div className="recommended-label">A LITTLE PRICE. A LOT MORE ROOM.</div>
        <span className="plan-label">FOR THE REGULAR NOTE-TAKER</span><h2>Pro <span className="plan-pill">UNLIMITED</span></h2><p className="plan-description">Every video. All the words.</p>
        <div className="price"><span>{recurrence === "monthly" ? "$1.99" : "$19.99"}</span><span className="price-period">/ {recurrence === "monthly" ? "month" : "year"}</span></div>
        {paidAction("regular")}<div className="plan-divider" /><ul className="plan-features"><li><Icon name="check" size={17} /><strong>Unlimited transcripts</strong></li><li><Icon name="check" size={17} /><strong>Download transcripts as .txt</strong></li><li><Icon name="check" size={17} />Read and copy transcripts</li><li><Icon name="check" size={17} />Languages and timestamps</li></ul>
      </section>
      <section className="price-card support-plan">
        <span className="plan-label">A LITTLE EXTRA KINDNESS</span><h2>Support Me Pro <span aria-hidden="true" className="support-heart">♡</span></h2><p className="plan-description">The same Pro. A little more support.</p>
        <div className="price"><span>{recurrence === "monthly" ? "$3.20" : "$28.34"}</span><span className="price-period">/ {recurrence === "monthly" ? "month" : "year"}</span></div>
        {paidAction("support")}<div className="plan-divider" /><ul className="plan-features"><li><Icon name="check" size={17} />All the same Pro features</li><li><Icon name="check" size={17} />Unlimited transcripts</li><li><Icon name="check" size={17} />Download transcripts as .txt</li><li><Icon name="check" size={17} />Help cover the running costs</li></ul>
      </section>
    </div>
    {error && <p className="notice checkout-error" role="alert"><Icon name="warning" size={18} />{error}</p>}
    <div className="pricing-footnote"><Icon name="lock" size={14} /><span>All paid memberships include a 1-week free trial through Gumroad. Active trials have full Pro access.</span></div>
    <p className="pricing-fine-print">Support Me Pro is completely optional and provides exactly the same website access as Pro.</p>
  </>;
}
