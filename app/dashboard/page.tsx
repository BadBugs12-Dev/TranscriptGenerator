import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccount } from "@/lib/account";
import { Icon } from "@/components/icons";
import { RefreshAccount } from "@/components/refresh-account";

export const metadata: Metadata = { title: "Your dashboard", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let account: Awaited<ReturnType<typeof getAccount>>;
  try { account = await getAccount(); }
  catch {
    return <div className="dashboard-page page-width"><div className="page-intro dashboard-intro"><div className="eyebrow">YOUR ACCOUNT</div><h1>A small interruption.</h1><p>We couldn’t load your account right now. Please try again shortly.</p></div><Link href="/dashboard" className="button button-secondary">Try again <Icon name="arrow" size={17} /></Link></div>;
  }
  if (!account.user) redirect("/login?next=/dashboard");
  const endDate = account.expiresAt ? new Date(account.expiresAt) : null;
  const validDate = endDate && !Number.isNaN(endDate.getTime());
  // eslint-disable-next-line react-hooks/purity -- This dynamic Server Component computes remaining access for the current request.
  const days = validDate ? Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / 86_400_000)) : null;
  const dateText = validDate ? endDate.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;

  return <div className="dashboard-page page-width">
    <div className="dashboard-heading"><div className="page-intro dashboard-intro"><div className="eyebrow"><span className="status-dot" /> YOUR WORKSPACE, SIMPLIFIED</div><h1>Your account.</h1><p>{account.user.email || "Your transcripts start here."}</p></div><Link href="/" className="button button-primary">Get a transcript <Icon name="arrow" size={18} /></Link></div>
    <section className={`account-plan-card${account.isPro ? " account-pro" : ""}`}><div><div className="plan-label">YOUR CURRENT PLAN</div><h2>{account.isPro ? "Pro" : "Free"}<span className={`account-plan-badge${account.isPro ? " active-badge" : ""}`}>{account.isPro ? "ACTIVE" : "$0 / FOREVER"}</span></h2><p>{account.isPro ? "Unlimited videos. All the words. Your Pro access is active." : "A handy start for your everyday notes. Upgrade whenever you need more."}</p></div>{account.isPro ? <div className="plan-access-icon"><Icon name="check" size={28} /></div> : <Link href="/pricing" className="button button-primary">Upgrade to Pro <Icon name="arrow" size={17} /></Link>}</section>

    {account.isPro ? <div className="dashboard-grid"><section className="dashboard-card"><div className="dashboard-card-icon"><Icon name="file" size={21} /></div><div className="plan-label">TRANSCRIPT ACCESS</div><div className="dashboard-stat">Unlimited <span>∞</span></div><p>Generate as many transcripts as you need, and download them as .txt files.</p></section><section className="dashboard-card"><div className="dashboard-card-icon"><Icon name="check" size={21} /></div><div className="plan-label">PRO ACCESS UNTIL</div><div className="dashboard-date">{dateText || "Active"}</div><p>{days !== null ? `${days === 1 ? "About 1 day" : `About ${days} days`} of Pro access remaining.` : "Your membership includes full Pro access."}</p>{account.subscriptionId && <a className="text-link" href="https://gumroad.com/library" target="_blank" rel="noreferrer">Manage Subscription <Icon name="external" size={14} /></a>}</section></div> : <div className="dashboard-grid"><section className="dashboard-card"><div className="usage-card-heading"><div className="plan-label">TODAY’S TRANSCRIPTS</div><span>Daily allowance</span></div><div className="dashboard-stat">{account.today}<span> / 3</span></div><div className="usage-track" role="meter" aria-label="Daily transcript usage" aria-valuemin={0} aria-valuemax={3} aria-valuenow={Math.min(account.today, 3)}><span style={{ width: `${Math.min(account.today / 3, 1) * 100}%` }} /></div><p><strong>{Math.max(0, 3 - account.today)} remaining</strong> today.</p></section><section className="dashboard-card"><div className="usage-card-heading"><div className="plan-label">THIS MONTH’S TRANSCRIPTS</div><span>Monthly allowance</span></div><div className="dashboard-stat">{account.month}<span> / 15</span></div><div className="usage-track" role="meter" aria-label="Monthly transcript usage" aria-valuemin={0} aria-valuemax={15} aria-valuenow={Math.min(account.month, 15)}><span style={{ width: `${Math.min(account.month / 15, 1) * 100}%` }} /></div><p><strong>{Math.max(0, 15 - account.month)} remaining</strong> this month.</p></section></div>}
    <div className="dashboard-note"><div><Icon name="lock" size={18} /><p>{account.isPro ? "Just activated a trial or membership? Gumroad confirmation may take a moment to reach your account." : "Free accounts can use up to 3 transcripts per day and 15 per month. Failed requests don’t count."}</p></div><RefreshAccount /></div>
    {!account.isPro && <div className="dashboard-upgrade"><div><h2>A little more room to take notes.</h2><p>Unlimited transcripts and .txt downloads from $1.99/month. Includes a 1-week free trial.</p></div><Link href="/pricing" className="text-link">See Pro plans <Icon name="arrow" size={18} /></Link></div>}
  </div>;
}
