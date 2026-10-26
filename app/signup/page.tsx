import { redirect } from "next/navigation";
import AuthForm from "@/app/auth-form";
import { getAccount } from "@/lib/account";
import { safeNext } from "@/lib/auth-redirect";
export const metadata = {title:"Create an account",robots:{index:false,follow:false}};
export default async function Signup({searchParams}:{searchParams:Promise<{next?:string}>}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const account = await getAccount();
  if(account.user) redirect(next);
  return <div className="auth-shell"><div className="auth-card"><p className="eyebrow">A LITTLE MORE ROOM</p><h1 className="auth-heading">Make it a habit.</h1><p className="muted">Get 3 transcripts a day, up to 15 a month. Free.</p><AuthForm mode="signup" next={next}/></div></div>;
}
