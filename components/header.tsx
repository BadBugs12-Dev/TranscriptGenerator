import Link from "next/link";
import { getAccount } from "@/lib/account";
import { BRAND } from "@/lib/config";
import { BrandMark, Icon } from "@/components/icons";

export async function Header() {
  const account = await getAccount().catch(() => null);

  return <header className="site-header">
    <div className="header-inner">
      <Link href="/" className="brand" aria-label={`${BRAND} home`}><BrandMark /><span>{BRAND}</span></Link>
      <nav aria-label="Main navigation" className="main-nav">
        <Link href="/pricing" className="nav-link">Pricing</Link>
        {account?.user ? <>
          <Link href="/dashboard" className="nav-link">Dashboard</Link>
          <form action="/auth/signout" method="post"><button type="submit" className="button button-small button-secondary">Log out</button></form>
        </> : <Link href="/login" className="button button-small button-secondary">Log in <Icon name="arrow" size={15} /></Link>}
      </nav>
    </div>
  </header>;
}
