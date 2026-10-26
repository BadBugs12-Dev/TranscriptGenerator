import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
function secret() {
  const value = process.env.APP_SIGNING_SECRET;
  if (!value || value.length < 32) throw new Error("APP_SIGNING_SECRET must contain at least 32 characters");
  return value;
}
export function assertSigningConfigured() { secret(); }
export type SignedState = { purpose: "trial" | "transcript"; owner: string; videoId?: string; expires: number };
export function signState(state: SignedState) {
  const encoded = Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature = createHmac("sha256",secret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}
export function verifyState(token: unknown, purpose: SignedState["purpose"], now = Date.now()): SignedState | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = createHmac("sha256",secret()).update(parts[0]).digest();
  const actual = Buffer.from(parts[1],"base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected,actual)) return null;
  try {
    const state: SignedState = JSON.parse(Buffer.from(parts[0],"base64url").toString());
    if (state.purpose !== purpose || typeof state.owner !== "string" || !Number.isFinite(state.expires) || state.expires <= now) return null;
    return state;
  } catch {return null;}
}
