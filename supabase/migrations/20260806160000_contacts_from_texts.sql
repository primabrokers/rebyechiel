-- People who text in become contacts, so the Rov's queue shows a person and not a phone number,
-- and so the assistant never asks a returning caller for their name a second time.
--
-- A contact is a profile with no auth_user_id: somebody the Rov knows of, who has never signed
-- in. Nothing about RLS changes — a NULL auth_user_id matches no auth.uid(), so a contact row is
-- invisible to every community user and visible only to the Rov and his assistant, exactly as a
-- phone number in his pocket would be.
ALTER TABLE public.rabbi_profiles ALTER COLUMN auth_user_id DROP NOT NULL;

-- One person per number. This is what lets a text-in contact and a later sign-up from the same
-- mobile become the same person rather than two half-records of one.
CREATE UNIQUE INDEX IF NOT EXISTS rabbi_profiles_phone_key
  ON public.rabbi_profiles (phone) WHERE phone IS NOT NULL;
