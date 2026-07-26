# Rabbi Emanuel's Assistant

Schedule and shailah management for Rabbi Yechiel Emanuel — a kehillah app (ask a shailah,
book a phone call, ask to meet, invite the Rov to speak) with an ultra-simple console for the
Rov, an AI PA that triages questions, a text-in SMS assistant for people without smartphones,
and a daily morning briefing. Installable as a PWA on Android and iOS.

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

## Design

"Rov Console" — cool graphite with a single indigo accent, Manrope throughout and JetBrains
Mono reserved for things that should read as data (times, refs, phone numbers). There is no
second accent: green means settled, amber means waiting on a person, red means promised today.
Tokens live in `tailwind.config.ts`; the source screens are in `design/`.

Two grammars share the palette. The Rov's console is dense and desktop-first: below `md` it is
a phone column with a bottom tab bar, from `md` up the tabs become a dark side rail carrying
live counts, and from `lg` the pages split into columns — Today puts what needs a decision
beside the day's diary, the queue becomes a table, and answering opens in a drawer over it so
he never loses his place.

The kehillah's screens are roomy and tappable, and change shape rather than stretching. On a
phone each one fills the device. From `md` up — a tablet, or the laptop most people will
actually open the website on — `<Screen>` turns it into a card on the page ground, sized to its
content: sign-in puts the hero beside the form instead of a thousand pixels above it, home puts
what you can ask beside where things stand, and the invitation form takes two columns.

Anything pinned to the window (drawers, toasts) renders through `<Portal>`. Chromium keeps a
containing block on an element that has animated its transform, so a `fixed` child inside a
page that faded up would otherwise be measured against that page instead of the window.

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
3. The Rov sets his mobile number in the app (Settings → Where we reach you) for briefings and
   nudges.

## Architecture notes

- Community writes go through the `rabbi-public` edge function so reply promises and slot
  capacity can't be bypassed; the SMS bot commits through the same `_shared/rabbiCore.ts` paths.
- Bookable times come from a weekly pattern, not hand-made windows: `rabbi_availability` holds
  "every Sunday 19:00–20:00, ten minutes each", `expandSlots()` projects it onto the next 21
  days, and `rabbi_time_off` takes a date out of it. One-off `rabbi_slot_releases` are additions
  on top, for a genuinely extra hour. Shabbos, his fixed timetable, and anything already booked
  are subtracted from the result — so a slot is only ever offered if it is really free.
- Reply promises are deterministic (`_shared/rabbiEta.ts`): same-day categories (niddah) with a
  configurable cutoff, hour-based and queue-based tiers, and nothing is ever promised or sent on
  Shabbos (proper yom tov calendar is a planned follow-up).
- Sensitive categories (niddah, shalom bayis) are masked in every list, excluded from SMS
  content, and invisible to the `assistant` role at the RLS layer.
- The SMS bot is a deterministic state machine; the model only interprets and drafts. It never
  answers halacha and hands off to a human after two confused turns — a handed-off conversation
  shows up in the console's "Text-in line" panel as "one caller needs a person".
- Invitations to speak (`rabbi_invitations`) never auto-confirm and never touch the diary: they
  sit as `requested` until the Rov answers one himself, and Today shows him any clash with his
  fixed week before he does.
