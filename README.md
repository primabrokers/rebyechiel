# Rabbi Emanuel's Assistant

Schedule and shailah management for Rabbi Yechiel Emanuel — a community app (ask a shailah,
book a phone call, request a meeting) with an ultra-simple admin for the Rov, an AI PA that
triages questions, a text-in SMS assistant for people without smartphones, and a daily
morning briefing. Installable as a PWA on Android and iOS.

## Stack

- **Front end**: React 18 + Vite + TypeScript + Tailwind (repo root). Deployed on Vercel.
- **Back end**: Supabase project `neiqcssajyivkbfjcaet` — Postgres (all tables `rabbi_`-prefixed,
  RLS throughout), Auth, and Deno edge functions in `supabase/functions/`.
- **SMS**: TextMagic. **AI**: Anthropic Claude (triage, SMS bot, briefing) and OpenAI
  (voice-note transcription, `gpt-4o-mini-transcribe`).

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
| `ANTHROPIC_API_KEY` | AI triage, SMS bot, daily briefing |
| `OPENAI_API_KEY` | Voice-note transcription |

Stored in the database vault (already set): `project_url`, `cron_internal_secret`,
`RABBI_SMS_WEBHOOK_SECRET`.

## One-time setup

1. **Make the Rov admin** after he signs up in the app:
   `UPDATE rabbi_profiles SET role = 'rabbi' WHERE phone = '+44…';`
   (use `'assistant'` for a rebbetzin/gabbai — assistants never see sensitive shailos).
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
