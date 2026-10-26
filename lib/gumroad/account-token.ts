import crypto from "node:crypto";

const TOKEN_TTL_SECONDS = 60 * 60;

function secret() {
  const value = process.env.GUMROAD_ACCOUNT_TOKEN_SECRET;
  if (!value) throw new Error("Missing GUMROAD_ACCOUNT_TOKEN_SECRET");
  return value;
}

export function createAccountToken(userId: string) {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = `${userId}.${expiresAt}`;
  const signature = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyAccountToken(token: string, atUnixSeconds = Math.floor(Date.now() / 1000)): string | null {
  const [userId, expiresAtRaw, signature] = token.split(".");
  if (!userId || !expiresAtRaw || !signature) return null;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < atUnixSeconds) return null;

  const payload = `${userId}.${expiresAtRaw}`;
  const expected = crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  return userId;
}
