"use client";
import Link from "next/link";
import { useActionState } from "react";
import { authenticate, type AuthState } from "./auth-actions";
export default function AuthForm({mode,next}:{mode:"login"|"signup";next:string}) {
  const [state,action,pending] = useActionState<AuthState,FormData>(authenticate.bind(null,mode),{});
  return <form action={action}>
    <input type="hidden" name="next" value={next}/>
    <label className="field-label" htmlFor="email">Email address</label>
    <input className="text-input" id="email" name="email" type="email" autoComplete="email" required maxLength={254}/>
    <label className="field-label" htmlFor="password">Password</label>
    <input className="text-input" id="password" name="password" type="password" autoComplete={mode==="login"?"current-password":"new-password"} required minLength={8} maxLength={128} aria-describedby="password-hint"/>
    <p id="password-hint" className="muted">Use at least 8 characters.</p>
    {state.error&&<p className="form-error" role="alert">{state.error}</p>}
    {state.message&&<p className="form-message" role="status">{state.message}</p>}
    <button className="button button-primary" type="submit" disabled={pending}>{pending?"Please wait…":mode==="login"?"Log in":"Create free account"}</button>
    <p className="muted">{mode==="login"?"New here? ":"Already have an account? "}<Link className="text-link" href={`${mode==="login"?"/signup":"/login"}?next=${encodeURIComponent(next)}`}>{mode==="login"?"Create an account":"Log in"}</Link></p>
  </form>;
}
