import Link from "next/link";
import { BRAND } from "@/lib/config";
import { BrandMark } from "@/components/icons";

export function Footer() {
  return <footer className="site-footer"><div className="footer-inner"><Link href="/" className="footer-brand"><BrandMark size={22} /><span>{BRAND}</span></Link><span className="footer-caption">Less watching. More doing.</span><Link href="/pricing" className="footer-link">Simple pricing <span aria-hidden="true">↗</span></Link></div></footer>;
}
