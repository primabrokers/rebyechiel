-- The text-in line is the Rov's alone to read.
--
-- rabbi_messages and rabbi_conversations hold the actual words people text: a niddah shailah, a
-- shalom bayis matter, a question about somebody's child. Both tables were readable by any admin,
-- which includes the assistant role — and the ask-a-shailah screen tells people in as many words
-- that "this goes to the Rov alone — no helper of his can see it, in the app or anywhere else".
-- Sensitive shailos were hidden from helpers in rabbi_shailos while the same text sat in the open
-- one table over. That is a promise the app was not keeping.

CREATE OR REPLACE FUNCTION public.rabbi_is_rov()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rabbi_profiles
    WHERE auth_user_id = auth.uid() AND role = 'rabbi' AND is_active
  );
$$;

DROP POLICY IF EXISTS rabbi_messages_admin_read ON public.rabbi_messages;
CREATE POLICY rabbi_messages_rov_read ON public.rabbi_messages
  FOR SELECT USING (public.rabbi_is_rov());

DROP POLICY IF EXISTS rabbi_conversations_admin_read ON public.rabbi_conversations;
CREATE POLICY rabbi_conversations_rov_read ON public.rabbi_conversations
  FOR SELECT USING (public.rabbi_is_rov());

-- The console's side rail shows helpers that somebody needs ringing back. That is the one thing
-- about a conversation they legitimately need, so it comes through a function that returns the
-- number and nothing else — never the draft, never a word anybody wrote.
CREATE OR REPLACE FUNCTION public.rabbi_handed_off_lines()
RETURNS TABLE (id uuid, phone text, updated_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.id, c.phone, c.updated_at
  FROM public.rabbi_conversations c
  WHERE c.state = 'handed_off'
    AND EXISTS (
      SELECT 1 FROM public.rabbi_profiles p
      WHERE p.auth_user_id = auth.uid() AND p.role IN ('rabbi', 'assistant') AND p.is_active
    )
  ORDER BY c.updated_at DESC;
$$;

REVOKE ALL ON FUNCTION public.rabbi_handed_off_lines() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rabbi_handed_off_lines() TO authenticated, service_role;
