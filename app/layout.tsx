import type { Metadata } from "next";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { BRAND } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: `${BRAND} — YouTube transcript generator`, template: `%s | ${BRAND}` },
  description: "Get clean YouTube transcripts from existing captions. Paste a video link, choose a language, and read or copy your transcript. Free to start.",
  openGraph: {
    title: `${BRAND} — YouTube transcripts. Instantly.`,
    description: "Get clean transcripts from videos using their existing captions. Paste a YouTube link to get started.",
    type: "website",
    siteName: BRAND,
  },
  robots: { index: true, follow: true },
  icons: { icon: "/favicon.svg", apple: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><a href="#main-content" className="skip-link">Skip to content</a><Header /><main id="main-content" tabIndex={-1}>{children}</main><Footer /></body></html>;
}
