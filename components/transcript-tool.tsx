"use client";

import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons";
import { formatTimestamp as timestamp, formatTranscript } from "@/lib/transcript-format";
import type { TranscriptResult, TranscriptSegment as Segment } from "@/lib/youtube/types";

type ToolError = { message: string; code?: string };

function cleanText(segments: Segment[]) {
  return segments.map((segment) => segment.text.trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

function paragraphs(segments: Segment[]) {
  return formatTranscript(segments).split("\n\n").filter(Boolean);
}

export function TranscriptTool({ signedIn, initialIsPro, initialToday, initialMonth }: { signedIn: boolean; initialIsPro: boolean; initialToday: number; initialMonth: number }) {
  const [url, setUrl] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [result, setResult] = useState<TranscriptResult | null>(null);
  const [receipt, setReceipt] = useState<string | undefined>();
  const [isPro, setIsPro] = useState(initialIsPro);
  const [today, setToday] = useState(initialToday);
  const [month, setMonth] = useState(initialMonth);
  const [trialUsed, setTrialUsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [timestamps, setTimestamps] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<ToolError | null>(null);
  const [actionMessage, setActionMessage] = useState("");
  const [downloadGate, setDownloadGate] = useState(false);
  const resultRef = useRef<HTMLElement>(null);

  async function retrieve(input: string, language?: string, existingReceipt?: string) {
    setBusy(true);
    setError(null);
    setActionMessage("");
    setDownloadGate(false);
    try {
      const response = await fetch("/api/transcript", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: input, language, receipt: existingReceipt }),
      });
      const data = await response.json();
      if (!response.ok || !data.result) {
        setError({ message: data.error || "We couldn’t retrieve this transcript. Please try again.", code: data.code });
        return;
      }
      setResult(data.result);
      setSourceUrl(input);
      setReceipt(data.receipt);
      setIsPro(Boolean(data.isPro));
      setCopied(false);
      if (!existingReceipt && !data.isPro) {
        if (signedIn) { setToday((value) => value + 1); setMonth((value) => value + 1); }
        else setTrialUsed(true);
      }
      setTimeout(() => resultRef.current?.focus({ preventScroll: true }), 0);
    } catch {
      setError({ message: "We couldn’t reach the server. Check your connection and try again." });
    } finally { setBusy(false); }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = url.trim();
    if (!input || busy) return;
    void retrieve(input, undefined, sourceUrl === input ? receipt : undefined);
  }

  async function copyTranscript() {
    if (!result) return;
    const text = formatTranscript(result.segments, timestamps);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setActionMessage("Transcript copied to your clipboard.");
      setTimeout(() => setCopied(false), 2500);
    } catch { setActionMessage("Copy isn’t available in this browser. You can select and copy the transcript below."); }
  }

  async function downloadTranscript() {
    if (!result || downloading) return;
    if (!isPro) { setDownloadGate(true); return; }
    setDownloading(true);
    setActionMessage("");
    try {
      const response = await fetch("/api/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: sourceUrl, language: result.language, timestamps, receipt }),
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setDownloadGate(true);
        else { const data = await response.json(); setActionMessage(data.error || "The download couldn’t be prepared. Please try again."); }
        return;
      }
      const blobUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = blobUrl;
      anchor.download = `${result.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, "").slice(0, 100) || result.videoId}.txt`;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      setActionMessage("Your transcript download is ready.");
    } catch { setActionMessage("The download couldn’t be prepared. Please try again."); }
    finally { setDownloading(false); }
  }

  const noCaptions = error?.code === "NO_CAPTIONS";
  const authRequired = error?.code === "AUTH_REQUIRED" || error?.code === "TRIAL_USED" || error?.code === "ANONYMOUS_LIMIT";
  const limited = Boolean(error?.code && /LIMIT|QUOTA/.test(error.code)) && !authRequired;

  return <div className="tool-wrap">
    <section className="tool-panel" aria-label="YouTube transcript generator">
      <div className="tool-topline"><label htmlFor="youtube-url" className="field-label">Your YouTube link</label><span className="tool-private"><Icon name="lock" size={12} /> No video downloads</span></div>
      <form className="url-form" onSubmit={submit}>
        <div className="url-input-wrap"><Icon name="link" size={21} /><input id="youtube-url" name="url" type="text" inputMode="url" autoComplete="off" spellCheck={false} placeholder="Paste a YouTube video link…" value={url} onChange={(event) => setUrl(event.target.value)} required aria-describedby="url-help" disabled={busy} /></div>
        <button className="button button-primary generate-button" type="submit" disabled={busy || !url.trim()}>{busy ? <><span className="spinner" /> Getting transcript</> : <>Get Transcript <Icon name="arrow" size={18} /></>}</button>
      </form>
      <div className="tool-bottomline"><span id="url-help">No AI <span aria-hidden="true">•</span> No waiting <span aria-hidden="true">•</span> Existing captions</span><span className="usage-hint">{isPro ? <><span className="tiny-dot" /> Pro · Unlimited transcripts</> : signedIn ? `${Math.min(today, 3)} / 3 today · ${Math.min(month, 15)} / 15 this month` : trialUsed ? "Trial used · Create a free account for more" : "Your first transcript is on us"}</span></div>
    </section>

    {error && <div className="notice error-notice" role="alert"><div className="notice-icon"><Icon name={noCaptions ? "file" : "warning"} size={21} /></div><div><h2>{noCaptions ? "No captions available" : authRequired ? "Keep going with a free account" : limited ? "You’ve reached your Free limit" : "We couldn’t get that transcript"}</h2><p>{noCaptions ? "This video doesn’t have captions available, so TranscriptGenerator can’t create a transcript." : error.message}</p>{authRequired ? <Link className="text-link" href="/signup">Create a free account <span aria-hidden="true">→</span></Link> : limited ? <Link className="text-link" href="/pricing">Get unlimited transcripts with Pro <span aria-hidden="true">→</span></Link> : null}</div></div>}

    {busy && !result && <div className="transcript-placeholder loading-placeholder" role="status"><div className="empty-icon"><span className="spinner" /></div><h2>Finding the words…</h2><p>Checking the video’s available caption tracks.</p><div className="skeleton-lines" aria-hidden="true"><span /><span /><span /></div></div>}

    {!result && !busy && !error && <div className="transcript-placeholder"><div className="empty-icon"><Icon name="file" size={25} /></div><h2>A video’s worth of words.</h2><p>Paste a link above. Your transcript will appear here.</p><div className="placeholder-line"><span /><span /><span /></div><span className="empty-label">READY WHEN YOU ARE</span></div>}

    {result && <section ref={resultRef} tabIndex={-1} className={`result-panel${busy ? " result-loading" : ""}`} aria-label="Your transcript" aria-busy={busy}>
      <div className="result-video">
        {/* The thumbnail URL comes from the server's normalized YouTube result. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {result.thumbnail && <img className="video-thumbnail" src={result.thumbnail} alt="" width={128} height={72} />}
        <div className="video-info"><div className="result-eyebrow"><span className="tiny-dot" /> TRANSCRIPT READY</div><h2>{result.title}</h2><p>{result.channel}{result.channel && result.duration ? <span aria-hidden="true"> · </span> : null}{result.duration ? `${timestamp(result.duration)} video` : null}</p></div>
        <a href={`https://www.youtube.com/watch?v=${encodeURIComponent(result.videoId)}`} className="icon-button video-external" target="_blank" rel="noreferrer" aria-label="Open video on YouTube (opens in a new tab)"><Icon name="external" size={17} /></a>
      </div>
      <div className="result-toolbar">
        <div className="result-options">
          {result.languages.length > 1 ? <label className="language-select"><span className="sr-only">Caption language</span><select value={result.language} disabled={busy} onChange={(event) => void retrieve(sourceUrl, event.target.value, receipt)}>{result.languages.map((language) => <option key={language.id} value={language.id}>{language.label}</option>)}</select><Icon name="chevron" size={14} /></label> : <span className="language-label">{result.languages[0]?.label || "Captions"}</span>}
          <span className="toolbar-divider" />
          <label className="timestamp-toggle"><input type="checkbox" checked={timestamps} onChange={(event) => setTimestamps(event.target.checked)} /><span className="switch-track" aria-hidden="true"><span /></span><span>Timestamps</span></label>
        </div>
        <div className="result-actions"><button className="button button-small button-secondary" onClick={() => void copyTranscript()} disabled={busy}><Icon name={copied ? "check" : "copy"} size={15} />{copied ? "Copied" : "Copy"}</button><button className="button button-small button-secondary" onClick={() => void downloadTranscript()} disabled={busy || downloading}><Icon name="download" size={15} />{downloading ? "Preparing…" : "Download .TXT"}{!isPro && <span className="mini-pro">PRO</span>}</button></div>
      </div>
      {downloadGate && <div className="download-notice" role="status"><Icon name="lock" size={18} /><div><strong>Keep a copy with Pro.</strong><span> Transcript downloads are a Pro feature. You can still read and copy the full transcript.</span> <Link className="text-link" href="/pricing">Explore Pro →</Link></div><button className="icon-button" onClick={() => setDownloadGate(false)} aria-label="Dismiss download message"><Icon name="x" size={15} /></button></div>}
      <div className="transcript-content" aria-label="Transcript text">{timestamps ? result.segments.map((segment, index) => <p className="timestamp-line" key={`${segment.start}-${index}`}><span className="transcript-time">[{timestamp(segment.start)}]</span><span>{segment.text}</span></p>) : paragraphs(result.segments).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
      <div className="result-bottomline"><span>{cleanText(result.segments).split(/\s+/).filter(Boolean).length.toLocaleString()} words <span aria-hidden="true">·</span> Existing YouTube captions</span><a className="text-link" href="#youtube-url" onClick={() => document.getElementById("youtube-url")?.focus()}>Try another video <span aria-hidden="true">↑</span></a></div>
    </section>}
    <p className="action-status" role="status" aria-live="polite">{actionMessage}</p>
  </div>;
}
