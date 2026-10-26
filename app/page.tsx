import { getAccount } from "@/lib/account";
import { TranscriptTool } from "@/components/transcript-tool";
import { Icon } from "@/components/icons";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const account = await getAccount().catch(() => null);
  return <div className="home-page page-width">
    <section className="hero" aria-labelledby="hero-title">
      <div className="eyebrow"><span className="status-dot" /> A LITTLE LESS PLAY. A LOT MORE TEXT.</div>
      <h1 id="hero-title">YouTube transcripts.<br /><span>Instantly.</span></h1>
      <p className="hero-description">Get clean transcripts from videos using their existing captions.</p>
    </section>
    <TranscriptTool signedIn={Boolean(account?.user)} initialIsPro={account?.isPro ?? false} initialToday={account?.today ?? 0} initialMonth={account?.month ?? 0} />
    <section className="benefits" aria-label="How it works">
      <div className="benefit"><span className="benefit-icon"><Icon name="link" /></span><div><h2>Paste a link</h2><p>Videos, Shorts, and share links.</p></div></div>
      <div className="benefit"><span className="benefit-icon"><Icon name="file" /></span><div><h2>Make it readable</h2><p>Choose a language. Toggle timestamps.</p></div></div>
      <div className="benefit"><span className="benefit-icon"><Icon name="copy" /></span><div><h2>Take the words with you</h2><p>Copy for free. Download with Pro.</p></div></div>
    </section>
    <p className="caption-note">Built for videos that already have captions. No captions? We’ll let you know.</p>
  </div>;
}
