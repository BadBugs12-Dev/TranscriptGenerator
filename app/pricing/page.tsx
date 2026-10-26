import type { Metadata } from "next";
import { getAccount } from "@/lib/account";
import { PricingPlans } from "@/components/pricing-plans";

export const metadata: Metadata = { title: "Simple pricing", description: "Start with a free YouTube transcript account, or get unlimited transcripts and .txt downloads with Pro for $1.99/month or $19.99/year." };
export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const account = await getAccount().catch(() => null);
  return <div className="pricing-page page-width"><div className="page-intro"><div className="eyebrow"><span className="status-dot" /> SIMPLE TOOL. SIMPLE PRICING.</div><h1>More words.<br /><span>Less to think about.</span></h1><p>Start free. Go unlimited whenever you need more.</p></div><PricingPlans signedIn={Boolean(account?.user)} isPro={account?.isPro ?? false} /><section className="pricing-answer"><div><h2>What am I getting?</h2><p>Clean text from a YouTube video’s existing captions. Every plan includes the full transcript, language selection, and optional timestamps.</p></div><div><h2>What if a video has no captions?</h2><p>We’ll tell you clearly, and the attempt won’t use your transcript allowance. This tool retrieves captions that already exist.</p></div></section></div>;
}
