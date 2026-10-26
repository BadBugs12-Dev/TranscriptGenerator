# TranscriptGenerator

A focused YouTube transcript utility: paste a watch, Shorts, or youtu.be link, retrieve its existing public captions, choose a caption language, and read/copy the text with optional timestamps. Pro adds unlimited transcripts and `.txt` downloads. No audio downloads, speech recognition, AI transcription, or AI fallback.

## Stack and local development

Next.js 16 App Router, React, TypeScript, Supabase Auth with `@supabase/ssr`, Supabase PostgreSQL, and Gumroad memberships. Node.js 22 or newer; no separate application server.

```sh
npm install
cp .env.example .env.local
# Fill in the environment variables below.
npm run dev
```

On PowerShell, use `Copy-Item .env.example .env.local` instead of `cp` if desired. Open the local address printed by Next.js.

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

Package versions and the lockfile are committed. `npm ci` is suitable for repeatable CI installs. The public pages can build without live credentials; generation/account/payment operations require their configuration. Do not use placeholder environment values in production.

## Environment variables

Set these in `.env.local` and, after deployment approval, in Vercel's environment settings. Do not commit `.env.local`.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-safe publishable key. |
| `SUPABASE_SECRET_KEY` | Server-only database/admin client key; never prefix it with `NEXT_PUBLIC_`. |
| `GUMROAD_ACCESS_TOKEN` | Server-only authenticated Gumroad API access. |
| `GUMROAD_ACCOUNT_TOKEN_SECRET` | Independent random signing secret for account checkout links. |
| `APP_SIGNING_SECRET` | Separate random secret of at least 32 characters for trial cookies and transcript receipts. Keep stable across instances/deployments. |
| `NEXT_PUBLIC_SITE_URL` | Full website origin used for signup confirmation redirects; use the local origin in development. |

Only the three `NEXT_PUBLIC_` values may appear in frontend code. The admin client and all signing/payment modules use `server-only` boundaries. Generate strong independent secrets with a password manager or a cryptographically secure random generator.

## Existing Supabase project

The target project is `eepqfeuwkvsdfhkxkfrm`, organization `Project-YT-Transcriber`. The application uses the existing `profiles`, `payments`, `transcript_usage`, and `pro_adjustments` tables and the existing Auth signup trigger. It does not recreate them or add a client-editable Pro flag.

The existing RLS policies allow authenticated users to read only their own rows, with no browser writes to payment, usage, subscription, or entitlement fields. Application account queries use a verified server user ID and explicitly filter by that ID. There is no cross-user data endpoint.

Additive setup SQL is in:

1. `sql/usage-functions.sql`: indexed account/time usage queries and a service-role-only atomic success-recording function.
2. `sql/payment-functions.sql`: verification snapshot columns on the existing profiles/payments tables, an index, and a service-role-only atomic payment reconciliation function.

These changes were applied and checked in the target project during implementation. For a fresh environment, apply the files after creating the assumed existing schema and RLS. Both functions are `SECURITY INVOKER`, revoke browser/public execution, and leave RLS intact. No new table is required. Do not grant these functions to `anon` or `authenticated`.

Enable email/password Auth. Configure the Supabase Site URL and redirect allowlist for the exact local/production origins, including `/auth/callback`. Signup uses PKCE and `/auth/callback` exchanges the confirmation code for a session. `/auth/confirm?token_hash=...&type=email` also supports a token-hash email template. If using that template, configure it explicitly in Supabase. Configure SMTP and delivery settings for production email.

Server pages/API authorization use `auth.getUser()`. `proxy.ts` refreshes sessions with verified `getClaims()` and forwards refreshed cookies/cache headers. Personalized pages and responses are dynamic/private, never shared-cache account sessions.

## Usage and Pro entitlement

- Anonymous visitors receive one successful transcript trial, tracked by a signed HttpOnly cookie for one year. This is deliberately best effort; clearing cookies or using another browser resets it.
- Free accounts receive at most 3 successful transcripts per UTC day and 15 per UTC calendar month. Both limits apply. Failed requests and videos without usable captions do not consume usage.
- Quota is checked before retrieval and atomically rechecked under a profile-row lock when committing a successful result. Concurrent requests cannot overdraw the account quota, including across Vercel instances.
- A short-lived signed receipt allows re-reading/changing an already retrieved video's language without charging another transcript. It is bound to the verified account/anonymous trial and video. Continued use refreshes its 30-minute lifetime. It cannot authorize a different video.
- Pro is always `profiles.pro_expires_at > now()`. Pro bypasses Free quotas and can download `.txt`. The download endpoint independently revalidates the server entitlement; frontend state cannot grant access.
- `pro_adjustments` and independent manual expiry extensions are preserved. No adjustment UI is included.

## Gumroad

Keep the existing product `arbvii` and required custom field named exactly **Account Token**. The existing product checkout URL is retained; its query parameters preselect the regular or Support tier and monthly/yearly billing, prefill the signed token and account email, and open checkout. Both paid tiers grant identical website Pro access. The 1-week trial uses the verified provider trial-end date.

Upgrade requires login and calls `POST /api/gumroad/checkout`. No anonymous checkout/account guessing. Checkout URLs are account-sensitive and expire after one hour; do not share them.

The webhook route is `POST /api/gumroad/webhook`. Gumroad Ping/webhook bodies are unsigned; a body only identifies a resource to re-fetch with `GUMROAD_ACCESS_TOKEN`. It cannot directly set a user ID, payment status, entitlement, or end date.

Configure Gumroad sale Ping to this route. For resource subscriptions, register the supported events. If Gumroad does not include `resource_name` in its form POST, put the corresponding name in the URL query:

```text
/api/gumroad/webhook?resource_name=refund
/api/gumroad/webhook?resource_name=dispute
/api/gumroad/webhook?resource_name=dispute_won
/api/gumroad/webhook?resource_name=cancellation
/api/gumroad/webhook?resource_name=subscription_updated
/api/gumroad/webhook?resource_name=subscription_ended
/api/gumroad/webhook?resource_name=subscription_restarted
```

The unqualified route defaults to `sale`. Events only grant/revoke access after checking actual sale/subscriber data, expected product, linked account, trial/billing period, and current subscription state. `payments.payment_id` remains unique. Database row locks and provider-verification observation timestamps make repeated/reordered requests idempotent and prevent stale events from undoing a later refund or end. A newer verified subscription can replace an older link; old callbacks cannot replace the newer membership.

Customer cancellation requests preserve the remaining period. Gumroad's `cancelled_at`, `ended_at`, and `failed_at` represent effective termination boundaries; `user_requested_cancellation_at` is not used to revoke access. Expiration is capped to the actual provider boundary. Manual Pro extensions remain independent.

Existing backend defects fixed: the documented single-subscriber API uses a plural `subscribers` response envelope; recurring sales can carry the original now-expired account token and must use established verified subscription linkage; unsigned refund notifications must not alone mark payments refunded; sale replay and concurrent updates need atomic reconciliation; month-end recurrence must clamp rather than overflow into the next month.

Provider references: [checkout URL parameters](https://gumroad.com/help/article/270-url-parameters), [membership end timestamp semantics](https://gumroad.com/help/article/76-license-keys), and the [official open-source API definitions](https://github.com/antiwork/gumroad/tree/main/app/javascript/components/ApiDocumentation/Endpoints).

## Caption retrieval architecture

`lib/youtube/` is the replaceable server-only adapter. Strict URL parsing accepts exact YouTube domains and validates an 11-character video ID; it never fetches the pasted URL. Native fetch requests a fixed first-party player endpoint, discovers actual caption tracks, then requests the chosen track's JSON3 captions. The current Android client is tried first, with an iOS fallback. These are public player requests, not the owner-authorized Data API `captions.download` endpoint.

Caption URLs returned upstream must match the first-party `/api/timedtext` endpoint and requested video ID. Redirects are disabled. Requests, response sizes, segment counts, and total retrieval time are bounded. The frontend receives only normalized metadata/language IDs/timestamped segments, never signed upstream track URLs or player internals.

No-caption responses require playable, valid player responses with no usable tracks. Private/deleted videos, restrictions, network errors, empty blocked caption responses, and YouTube IP blocks are distinguished from genuine no captions. No fake transcript/fallback exists.

YouTube can change these undocumented public player responses or block data-center egress IPs. Client version constants may need maintenance; the [yt-dlp YouTube extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_base.py) is a primary reference. [Cloud-IP blocking is a known limitation](https://github.com/jdepoix/youtube-transcript-api#working-around-ip-bans-requestblocked-or-ipblocked-exception). Live retrieval passed from this development Node runtime; Vercel egress remains unverified until an approved deployment. There is no paid proxy, audio fallback, or extra service configured.

## Verification

`npm test` runs deterministic tests for parsing/SSRF resistance, caption responses and failure classifications, formatting, signing, redirects, origin validation, input sizes, quota policy, and payment verification. Live YouTube tests are intentionally separate from deterministic tests:

```sh
npm run test:live
```

This verifies the public `jNQXAC9IVRw` video, English/German tracks and timestamps, and `hY7m5jjJ9mM` as a playable no-caption video. Availability/captions can change independently of this application.

Against a configured local server at `http://127.0.0.1:3147`, `node scripts/smoke-http.mjs` checks public pages, protected dashboard, origin/URL validation, checkout/download authentication, successful anonymous trial, second-request blocking, no-caption trial preservation, and same-video language receipts. Override `TEST_ORIGIN` for another local origin. This makes real public caption requests.

`tests/database.sql` and `tests/payments-database.sql` run privileged database assertions in transactions that **roll back all fixtures**. They check trigger/RLS restrictions, quota boundaries, Pro bypass/expiry, duplicate sales, renewal, trial, cancellation, end replay, stale refund protection, subscription replacement, and manual extensions. These passed in the target database. Security advisors reported no findings after setup.

Actual signup email delivery and live paid Gumroad checkout/webhook transactions require configured secrets/provider settings and have not been executed. UI rendering was checked through local HTTP responses and responsive source inspection; desktop apps were not controlled.

## Vercel deployment (approval required)

1. Review the implementation and approve the GitHub push/deployment. A push to a Vercel-linked branch can automatically deploy, so it is held pending approval.
2. Import the existing repository with Next.js framework detection. Use Node.js 22 or newer; root directory is the repository root, install is `npm ci`, build is `npm run build`.
3. Set the named environment variables above for the intended environment. Use the production site origin and independent signing secrets.
4. Confirm Supabase redirect URLs/email settings and Gumroad webhook resources point at the approved domain.
5. After approval, deploy and rerun public caption tests from Vercel, account signup/login/logout, trial activation, renewal/refund/cancellation/end delivery, and download behavior with a real Pro account.

No Vercel deployment is initiated by these setup files. Production cloud caption retrieval and live billing must be verified before treating the service as launch-ready.

## Important files

- `app/`, `components/`: home, results, pricing, account dashboard, signup/login and shared interface.
- `app/api/transcript/route.ts`, `app/api/download/route.ts`: server authorization, quota and export.
- `lib/youtube/`, `lib/transcript-format.ts`: caption adapter and text formatting.
- `lib/supabase/`, `proxy.ts`, `lib/account.ts`: verified SSR auth and account data.
- `app/api/gumroad/`, `lib/gumroad/`: preserved secure checkout and verified payment handling.
- `sql/`, `tests/`, `scripts/`: additive database setup and reproducible verification.

V1 intentionally omits transcript storage/history, audio/file uploads, speech transcription, extra export formats, analytics/admin tools, teams, ads, and other membership features.
