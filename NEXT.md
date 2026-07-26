# Next: answers route by the channel the question came in on

Agreed with the Rov, not yet built. These three belong in one change — they touch the same
paths, and doing one without the others leaves a half-answer.

## 1. An answer goes back the way the question came in

Today every asker gets the same "your answer is ready" text. For someone who texted in that is
useless: they have no app to read it in, so the headline feature for people without smartphones
currently ends in a dead end.

- `channel = 'sms'` → text them **the answer itself**, in full. Split across messages if long.
- `channel = 'app'` → keep the answer in the app, and text "your answer is ready" **with a link**
  straight to it (`/requests/<id>`).
- Sensitive categories (niddah, shalom bayis) are the exception on both paths: never put the
  answer in a text. Say it is ready and that he will ring, or that it can be read in the app.

Lives in `supabase/functions/rabbi-notify/index.ts`, where the answer-ready message is composed.

## 2. He can ask for more before answering

On an app question he may need a detail before he can answer. Needs a small back-and-forth:
a note from him on the shailah, texted/linked to the asker, their reply appended to the thread,
and the shailah held in `in_progress` without the promise clock being reset.

## 3. Contacts built from phone numbers

A texted-in person never gets a profile, so a repeat texter is asked their name every time and
reaches him as "Text-in caller".

- **Blocker:** `rabbi_profiles.auth_user_id` is `NOT NULL`. Make it nullable so a contact can
  exist without a login. RLS policies that join on `auth_user_id` must be re-checked — a null
  must never match a caller.
- When the SMS bot learns a name for an unknown number, create the profile (role `community`,
  `preferred_channel = 'sms'`, no auth user).
- Then it greets by name, stops re-asking, and his queue shows a real person whose questions and
  calls join up.
- **Merge case:** if that number later signs up in the app, attach the auth user to the existing
  contact rather than creating a second record. Get this right — one person as two records is
  worse than no contact list at all.

## 4. The Rov's console on a phone should be a phone app

Below `md` the console currently reflows the desktop rather than becoming something built for a
phone. He will use it standing in shul, one-handed, so this matters more than it sounds.

- **Diary.** A six-column week grid does not work at 390px. It should become one day at a time,
  swipeable, with the date strip along the top — the week view stays for tablet and desktop.
- **Opening times.** The 620px drawer becomes a bottom sheet that comes up from the bottom, with
  the chips at proper thumb size and the day headings sticky as he scrolls. This is the screen he
  is most likely to use on a phone and the least suited to it today.
- **Answer drawer.** Full-screen on a phone, not a side panel — with the question, the answer box
  and dictation stacked, and "Send the answer" pinned above the keyboard.
- Tap targets to 44px throughout, and the bottom bar respecting the home indicator (it already
  uses `env(safe-area-inset-bottom)`, but the sheets do not).
- Test at 390×844 with the on-screen keyboard up: several of these screens have a fixed footer
  that the keyboard will cover.
