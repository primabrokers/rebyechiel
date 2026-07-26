# Rabbi Emanuel's Assistant

Schedule and shailah management for Rabbi Yechiel Emanuel — a community app (ask a shailah,
book a phone call, request a meeting) with an ultra-simple admin for the Rov, an AI PA that
triages questions, a text-in SMS assistant for people without smartphones, and a daily
morning briefing. Installable as a PWA on Android and iOS.

## Stack

- **Front end**: React 18 + Vite + TypeScript + Tailwind (repo root). Deployed on Vercel.
- **Back end**: Supabase project `neiqcssajyivkbfjcaet` — Postgres (all tables `rabbi_`-prefixed,
  RLS throughout), Auth, and Deno edge functions in `supabase/functions/`.
- **SMS**: TextMagic. **AI**: OpenAI throughout — one account, one key, one bill:
  `gpt-5.4-nano` for shailah triage, `gpt-5.4-mini` for the SMS assistant and the morning
  briefing, `gpt-4o-mini-transcribe` for voice-note answers.

## Local development

```bash
npm install
VITE_SUPABASE_URL=https://neiqcssajyivkbfjcaet.supabase.co \
VITE_SUPABASE_ANON_KEY=<anon key> \
npm run dev
```

`npm run build` / `npm run typecheck` before pushing. The ETA promise engine has tests:
`deno test supabase/functions/_shared/rabbiEta_test.ts`.

## Deployment

- **Vercel**: project rooted at this repo's root; env vars `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_ANON_KEY`. `vercel.json` carries the SPA rewrite + CSP.
- **Supabase**: migrations in `supabase/migrations/` (bootstrap → core → crons → grants),
  functions deployed per `supabase/config.toml` (`rabbi-sms-inbound`, `rabbi-daily-brief` and
  `rabbi-notify` are `verify_jwt = false` and authenticate themselves).

## Required secrets (Supabase → Edge Functions → Secrets)

| Name | Purpose |
|---|---|
| `TEXTMAGIC_USERNAME` / `TEXTMAGIC_API_KEY` / `TEXTMAGIC_SENDER` | Outbound SMS |
| `OPENAI_API_KEY` | Everything AI: triage, SMS assistant, morning briefing, voice notes |

The named rows already exist (empty) in the database vault, so they can be filled in from
Database → Vault, or with `UPDATE vault.secrets SET secret = '…' WHERE name = '…';`. An empty
value is treated as "not configured" and the feature simply stays off.

Stored in the database vault (already set): `project_url`, `cron_internal_secret`,
`RABBI_SMS_WEBHOOK_SECRET`.

## Preview mode

`/preview` lets anyone click through both sides with invented sample data and no login —
useful for showing the Rov or the committee before there is anything real in the system.
`?preview=rabbi` and `?preview=member` jump straight in; the choice sticks for the browser tab.

Preview never reads or writes the database: the data layer returns fixtures from
`src/lib/demo.ts` and every action is a no-op, so it is safe to leave enabled on the live site.
A banner sits above every screen so it cannot be mistaken for real data.

## One-time setup

1. **Make the Rov admin.** He signs up in the app (email + password works with no keys
   configured), then promote that account:
   ```sql
   UPDATE rabbi_profiles p SET role = 'rabbi'
   FROM auth.users u WHERE u.id = p.auth_user_id AND u.email = 'his@email';
   ```
   Use `'assistant'` for a rebbetzin or gabbai — assistants never see sensitive shailos.
   He then lands on `/rabbi` automatically at every sign-in.
2. **Text-in**: buy a reply-capable TextMagic number and point its inbound webhook at
   `https://neiqcssajyivkbfjcaet.supabase.co/functions/v1/rabbi-sms-inbound?secret=<RABBI_SMS_WEBHOOK_SECRET>`.
3. The Rov sets his mobile number in the app (More → Messages to you) for briefings and nudges.

## Architecture notes

- Community writes go through the `rabbi-public` edge function so reply promises and slot
  capacity can't be bypassed; the SMS bot commits through the same `_shared/rabbiCore.ts` paths.
- Reply promises are deterministic (`_shared/rabbiEta.ts`): same-day categories (niddah) with a
  configurable cutoff, hour-based and queue-based tiers, and nothing is ever promised or sent on
  Shabbos (proper yom tov calendar is a planned follow-up).
- Sensitive categories (niddah, shalom bayis) are masked in every list, excluded from SMS
  content, and invisible to the `assistant` role at the RLS layer.
- The SMS bot is a deterministic state machine; Claude only interprets and drafts. It never
  answers halacha and hands off to a human after two confused turns.
