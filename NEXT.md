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
