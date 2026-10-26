import { redirect } from "next/navigation";
import AuthForm from "@/app/auth-form";
import { getAccount } from "@/lib/account";
import { safeNext } from "@/lib/auth-redirect";
export const metadata = {title:"Log in",robots:{index:false,follow:false}};
export default async function Login({searchParams}:{searchParams:Promise<{next?:string;error?:string}>}) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const account = await getAccount();
  if(account.user) redirect(next);
  return <div className="auth-shell"><div className="auth-card"><p className="eyebrow">WELCOME BACK</p><h1 className="auth-heading">Log in.</h1><p className="muted">Your transcripts, a little less limited.</p>{params.error&&<p className="form-error" role="alert">That confirmation link couldn’t be verified. Try logging in or request a new signup confirmation.</p>}<AuthForm mode="login" next={next}/></div></div>;
}
