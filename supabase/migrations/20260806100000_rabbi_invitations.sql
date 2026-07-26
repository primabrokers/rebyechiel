-- Invitations to speak (drashas) — the third thing the kehillah asks of the Rov, alongside
-- shailos and appointments. The redesign gives these their own flow because they are decided
-- differently: he answers every one himself, the details he needs are unlike a booking
-- (occasion, venue, roughly how many people), and a clash with his fixed week must be visible
-- before he says yes.
--
-- Also adds the organisation name the sign-up screen collects when someone picks "a Moisod or
-- organisation" — "Jewish High" is far more useful to him on a request than "mosdos".

ALTER TABLE rabbi_profiles ADD COLUMN IF NOT EXISTS organisation text;

CREATE SEQUENCE IF NOT EXISTS rabbi_invitation_ref_seq;

CREATE TABLE IF NOT EXISTS rabbi_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref text NOT NULL UNIQUE DEFAULT ('I-' || lpad(nextval('rabbi_invitation_ref_seq')::text, 4, '0')),
  profile_id uuid REFERENCES rabbi_profiles(id) ON DELETE SET NULL,
  contact_name text,
  contact_phone text,
  channel text NOT NULL DEFAULT 'app' CHECK (channel IN ('app', 'sms', 'whatsapp', 'staff')),
  occasion text NOT NULL CHECK (occasion IN (
    'sheva_brochos', 'bar_mitzvah', 'chanukas_habayis', 'shloshim', 'shiur', 'other'
  )),
  starts_at timestamptz NOT NULL,
  duration_minutes int NOT NULL DEFAULT 20 CHECK (duration_minutes BETWEEN 5 AND 240),
  location text,
  notes text,
  expected_attendance int,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'accepted', 'declined', 'cancelled')),
  decline_reason text,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rabbi_invitations_status ON rabbi_invitations (status, starts_at);
CREATE INDEX IF NOT EXISTS idx_rabbi_invitations_profile ON rabbi_invitations (profile_id, created_at DESC);

ALTER TABLE rabbi_invitations ENABLE ROW LEVEL SECURITY;

-- Same shape as bookings: you see your own, admins see and decide on all. Creation goes through
-- the rabbi-public edge function so the clash check runs server-side.
DROP POLICY IF EXISTS rabbi_invitations_select ON rabbi_invitations;
CREATE POLICY rabbi_invitations_select ON rabbi_invitations FOR SELECT USING (
  profile_id = public.rabbi_current_profile_id() OR public.rabbi_is_admin()
);
DROP POLICY IF EXISTS rabbi_invitations_admin_update ON rabbi_invitations;
CREATE POLICY rabbi_invitations_admin_update ON rabbi_invitations FOR UPDATE
  USING (public.rabbi_is_admin()) WITH CHECK (public.rabbi_is_admin());

-- The notification ledger needs to be able to reference an invitation.
ALTER TABLE rabbi_messages DROP CONSTRAINT IF EXISTS rabbi_messages_related_type_check;
ALTER TABLE rabbi_messages ADD CONSTRAINT rabbi_messages_related_type_check
  CHECK (related_type IN ('shailah', 'booking', 'invitation', 'briefing', 'otp', 'conversation', 'nudge'));

-- The SMS assistant can now collect an invitation as well as a shailah or a booking.
ALTER TABLE rabbi_conversations DROP CONSTRAINT IF EXISTS rabbi_conversations_state_check;
ALTER TABLE rabbi_conversations ADD CONSTRAINT rabbi_conversations_state_check
  CHECK (state IN ('idle', 'intent', 'collecting_shailah', 'collecting_booking',
                   'collecting_invitation', 'confirming', 'done', 'handed_off'));
