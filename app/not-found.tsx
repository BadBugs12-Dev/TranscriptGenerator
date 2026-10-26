import Link from "next/link";
import { Icon } from "@/components/icons";

export default function NotFound() {
  return <div className="empty-page page-width"><span className="eyebrow">404 · PAGE NOT FOUND</span><h1>Nothing to read here.</h1><p>This page doesn’t exist. Let’s get you back to the transcripts.</p><Link href="/" className="button button-primary">Back to the tool <Icon name="arrow" size={18} /></Link></div>;
}
