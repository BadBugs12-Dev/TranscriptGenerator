import type { CSSProperties, ReactNode } from "react";

type IconName = "arrow" | "check" | "chevron" | "copy" | "download" | "external" | "file" | "link" | "lock" | "play" | "spark" | "warning" | "x";

const paths: Record<IconName, ReactNode> = {
  arrow: <><path d="M4 12h15M13 6l6 6-6 6" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  chevron: <path d="m8 10 4 4 4-4" />,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></>,
  external: <><path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5" /></>,
  file: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h6" /></>,
  link: <><path d="m10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 0)" /></>,
  lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
  play: <path d="m9 6 9 6-9 6z" />,
  spark: <><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.5 5.5l2 2m9 9 2 2m0-13-2 2m-9 9-2 2" /><circle cx="12" cy="12" r="3" /></>,
  warning: <><path d="m10.2 4.3-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.8-2.7l-8-14a2 2 0 0 0-3.6 0ZM12 9v4M12 17h.01" /></>,
  x: <path d="m6 6 12 12M6 18 18 6" />,
};

export function Icon({ name, size = 20, className, style }: { name: IconName; size?: number; className?: string; style?: CSSProperties }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>{paths[name]}</svg>;
}

export function BrandMark({ size = 29 }: { size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 32 32" fill="none"><rect width="32" height="32" rx="9" fill="var(--accent)" /><path d="M9 9h14M9 14h14M9 19h9M9 24h5" stroke="#10261e" strokeWidth="2.2" strokeLinecap="round" /><path d="m22 20 4 2.5-4 2.5v-5Z" fill="#10261e" /></svg>;
}
