"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export function RefreshAccount() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return <button className="text-link refresh-account" onClick={() => startTransition(() => router.refresh())} disabled={pending}>{pending ? "Refreshing account…" : "Refresh account"}<span aria-hidden="true">↻</span></button>;
}
