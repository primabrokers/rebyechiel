-- A shailah no longer waits for somebody to reply YES: it goes to the Rov the moment there is
-- enough to send, and stays reworadable for half an hour afterwards. That needs two states the
-- conversation could not previously hold — "sent", and "amending" while they retype it.
--
-- Without this the insert succeeds and the very next line, writing the conversation state, fails
-- the CHECK: the Rov would have the question and the person would be told it went wrong.
ALTER TABLE public.rabbi_conversations DROP CONSTRAINT IF EXISTS rabbi_conversations_state_check;

ALTER TABLE public.rabbi_conversations ADD CONSTRAINT rabbi_conversations_state_check
  CHECK (state = ANY (ARRAY[
    'idle', 'intent',
    'collecting_shailah', 'collecting_booking', 'collecting_invitation',
    'confirming',   -- bookings only now; a booking takes a time out of someone else's hands
    'sent',         -- the shailah is with the Rov, and can still be reworded
    'amending',     -- they are retyping it
    'done', 'handed_off'
  ]));
