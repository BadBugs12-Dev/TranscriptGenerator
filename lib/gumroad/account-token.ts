import "server-only";
import crypto from "node:crypto";

const TOKEN_TTL_SECONDS = 60 * 60;

function secrets(): string[] {
  const values = [
    process.env.GUMROAD_ACCOUNT_TOKEN_SECRET,
    process.env.APP_SIGNING_SECRET,
  ].filter((value): value is string => Boolean(value));
  const unique = [...new Set(values)];
  if (!unique.length) throw new Error("Missing Gumroad account-token signing secret");
  return unique;
}

export function createAccountToken(userId: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${userId}.${expiresAt}`;
  const signature = crypto.createHmac("sha256", secrets()[0]).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyAccountToken(token: string, atUnixSeconds = Math.floor(Date.now() / 1000)): string | null {
  if (typeof token !== "string" || token.length > 256) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresAtRaw, signature] = parts;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) || !/^\d+$/.test(expiresAtRaw) || !signature) return null;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAt) || !Number.isFinite(atUnixSeconds) || expiresAt <= atUnixSeconds) return null;
  if (atUnixSeconds < expiresAt - TOKEN_TTL_SECONDS - 300) return null;

  const payload = `${userId}.${expiresAtRaw}`;
  const actual = Buffer.from(signature);

  for (const signingSecret of secrets()) {
    const expected = Buffer.from(crypto.createHmac("sha256", signingSecret).update(payload).digest("base64url"));
    if (actual.length === expected.length && crypto.timingSafeEqual(actual, expected)) return userId;
  }

  return null;
}
