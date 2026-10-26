"use client";

import Link from "next/link";
import { Icon } from "@/components/icons";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <div className="empty-page page-width"><span className="eyebrow">A SMALL INTERRUPTION</span><h1>Let’s try that again.</h1><p>Something went wrong while loading this page. Please try again in a moment.</p><div className="empty-page-actions"><button className="button button-primary" onClick={reset}>Try again <Icon name="arrow" size={18} /></button><Link href="/" className="button button-secondary">Back to the tool</Link></div></div>;
}
