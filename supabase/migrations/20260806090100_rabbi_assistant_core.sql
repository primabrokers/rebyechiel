-- Rabbi Emanuel's Assistant — core schema.
-- Standalone community app (rabbi-app/) sharing this Supabase project. Community members are
-- ordinary auth.users rows with a rabbi_profiles record; they never appear in staff_users or
-- portal_users, so every existing CRM policy (all keyed on those tables) denies them by
-- construction. Conversely, everything here keys off rabbi_profiles only — no CRM helper is
-- referenced or modified.

-- ---------------------------------------------------------------------------
-- Profiles: one row per auth user of the rabbi app. role is never client-settable —
-- inserts happen only via edge functions (service role); admins are seeded/promoted manually.
CREATE TABLE IF NOT EXISTS rabbi_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'community' CHECK (role IN ('rabbi', 'assistant', 'community')),
  full_name text NOT NULL,
  phone text,
  phone_verified_at timestamptz,
  affiliation text CHECK (affiliation IN ('shul_member', 'beis_hatalmud', 'mosdos', 'other')),
  preferred_channel text NOT NULL DEFAULT 'sms' CHECK (preferred_channel IN ('sms', 'whatsapp', 'email', 'app')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rabbi_profiles_phone ON rabbi_profiles (phone);

-- Singleton settings row (single-rabbi app by design; add an owner column if that ever changes).
CREATE TABLE IF NOT EXISTS rabbi_settings (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  timezone text NOT NULL DEFAULT 'Europe/London',
  daily_shailah_capacity int NOT NULL DEFAULT 10 CHECK (daily_shailah_capacity > 0),
  -- Same-day questions submitted after this local hour roll to the next day's promise.
  same_day_cutoff_hour int NOT NULL DEFAULT 15 CHECK (same_day_cutoff_hour BETWEEN 0 AND 23),
  -- The local hour a same-day promise points at ("by this evening").
  same_day_promise_hour int NOT NULL DEFAULT 22 CHECK (same_day_promise_hour BETWEEN 0 AND 23),
  calls_auto_confirm boolean NOT NULL DEFAULT true,
  meetings_auto_confirm boolean NOT NULL DEFAULT false,
  sms_notifications_enabled boolean NOT NULL DEFAULT true,
  briefing_enabled boolean NOT NULL DEFAULT true,
  rabbi_phone text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO rabbi_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Shailah categories, rabbi-editable. is_sensitive drives redaction (assistant role never sees
-- the question text; AI summaries stay generic; SMS notifications never quote the question).
CREATE TABLE IF NOT EXISTS rabbi_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  default_same_day boolean NOT NULL DEFAULT false,
  is_sensitive boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Urgency tiers, rabbi-editable. promise_type: same_day = answer by this evening (cutoff-aware);
-- hours = within promise_hours; queue_based = position in queue vs daily capacity.
CREATE TABLE IF NOT EXISTS rabbi_urgency_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  priority int NOT NULL DEFAULT 100,
  promise_type text NOT NULL DEFAULT 'queue_based' CHECK (promise_type IN ('same_day', 'hours', 'queue_based')),
  promise_hours int,
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS rabbi_shailah_ref_seq;
CREATE SEQUENCE IF NOT EXISTS rabbi_booking_ref_seq;

-- Shailos. status lifecycle: new → triaged → in_progress → answered → closed (or withdrawn).
CREATE TABLE IF NOT EXISTS rabbi_shailos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref text NOT NULL UNIQUE DEFAULT ('S-' || lpad(nextval('rabbi_shailah_ref_seq')::text, 4, '0')),
  profile_id uuid REFERENCES rabbi_profiles(id) ON DELETE SET NULL,
  channel text NOT NULL DEFAULT 'app' CHECK (channel IN ('app', 'sms', 'whatsapp', 'staff')),
  category_id uuid REFERENCES rabbi_categories(id) ON DELETE SET NULL,
  urgency_tier_id uuid REFERENCES rabbi_urgency_tiers(id) ON DELETE SET NULL,
  -- SMS-only askers have no auth account: profile_id stays null and contact_* identify them.
  contact_name text,
  contact_phone text,
  question text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'triaged', 'in_progress', 'answered', 'closed', 'withdrawn')),
  answer text,
  answered_at timestamptz,
  answered_by uuid REFERENCES rabbi_profiles(id) ON DELETE SET NULL,
  due_at timestamptz,
  expected_reply_text text,
  is_sensitive boolean NOT NULL DEFAULT false,
  -- AI triage suggestions (rabbi confirms in the UI; confirmation stamps triage_confirmed_*).
  ai_suggested_category_id uuid REFERENCES rabbi_categories(id) ON DELETE SET NULL,
  ai_suggested_urgency_id uuid REFERENCES rabbi_urgency_tiers(id) ON DELETE SET NULL,
  ai_summary text,
  ai_confidence numeric,
  triage_confirmed_at timestamptz,
  triage_confirmed_by uuid REFERENCES rabbi_profiles(id) ON DELETE SET NULL,
  handed_off boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rabbi_shailos_queue ON rabbi_shailos (status, due_at);
CREATE INDEX IF NOT EXISTS idx_rabbi_shailos_profile ON rabbi_shailos (profile_id, created_at DESC);

-- Fixed weekly commitments (davening, shiurim, school, chosson lessons, family time).
-- These block slot releases server-side: a released window never yields slots that overlap one.
CREATE TABLE IF NOT EXISTS rabbi_timetable_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  weekday int NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0 = Sunday
  start_time time NOT NULL,
  end_time time NOT NULL,
  label text NOT NULL,
  block_type text NOT NULL DEFAULT 'other' CHECK (block_type IN ('davening', 'shiur', 'school', 'chosson', 'family', 'other')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

-- Released bookable windows. The API expands a window into duration-sized slots, subtracting
-- confirmed bookings and timetable blocks.
CREATE TABLE IF NOT EXISTS rabbi_slot_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_type text NOT NULL CHECK (slot_type IN ('call', 'meeting')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  duration_minutes int NOT NULL DEFAULT 15 CHECK (duration_minutes BETWEEN 5 AND 120),
  location text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by uuid REFERENCES rabbi_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_rabbi_slot_releases_time ON rabbi_slot_releases (starts_at) WHERE status = 'open';

-- Bookings: calls auto-confirm (configurable); face-to-face meetings default to 'requested'
-- pending the rabbi's approval.
CREATE TABLE IF NOT EXISTS rabbi_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref text NOT NULL UNIQUE DEFAULT ('B-' || lpad(nextval('rabbi_booking_ref_seq')::text, 4, '0')),
  profile_id uuid REFERENCES rabbi_profiles(id) ON DELETE SET NULL,
  slot_release_id uuid REFERENCES rabbi_slot_releases(id) ON DELETE SET NULL,
  slot_type text NOT NULL CHECK (slot_type IN ('call', 'meeting')),
  contact_name text,
  contact_phone text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  purpose text,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'confirmed', 'declined', 'rescheduled', 'cancelled', 'completed')),
  decline_reason text,
  channel text NOT NULL DEFAULT 'app' CHECK (channel IN ('app', 'sms', 'whatsapp', 'staff')),
  reminder_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rabbi_bookings_time ON rabbi_bookings (starts_at);
CREATE INDEX IF NOT EXISTS idx_rabbi_bookings_profile ON rabbi_bookings (profile_id, created_at DESC);

-- SMS bot conversation state (one active conversation per phone). draft carries the
-- partially-collected shailah/booking; expires_at times a stale conversation back to idle.
CREATE TABLE IF NOT EXISTS rabbi_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  profile_id uuid REFERENCES rabbi_profiles(id) ON DELETE SET NULL,
  channel text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms', 'whatsapp')),
  state text NOT NULL DEFAULT 'idle' CHECK (state IN ('idle', 'intent', 'collecting_shailah', 'collecting_booking', 'confirming', 'done', 'handed_off')),
  intent text,
  draft jsonb NOT NULL DEFAULT '{}',
  turn_count int NOT NULL DEFAULT 0,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rabbi_conversations_phone ON rabbi_conversations (phone) WHERE state NOT IN ('done');

-- Full message log across channels — also the notification dedupe ledger (rabbi-notify checks
-- for an existing row with the same related_type/related_id/kind before sending).
CREATE TABLE IF NOT EXISTS rabbi_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid REFERENCES rabbi_conversations(id) ON DELETE SET NULL,
  profile_id uuid REFERENCES rabbi_profiles(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  channel text NOT NULL DEFAULT 'sms' CHECK (channel IN ('sms', 'whatsapp', 'email', 'app')),
  phone text,
  body text NOT NULL,
  provider_id text,
  related_type text CHECK (related_type IN ('shailah', 'booking', 'briefing', 'otp', 'conversation', 'nudge')),
  related_id uuid,
  kind text, -- e.g. 'confirmation', 'reminder', 'answer_ready', 'overdue_nudge'
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'received')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rabbi_messages_related ON rabbi_messages (related_type, related_id, kind);
CREATE INDEX IF NOT EXISTS idx_rabbi_messages_created ON rabbi_messages (created_at DESC);

-- Phone OTP codes for community login (mirrors portal_sms_codes: salted hash, TTL, attempt cap).
CREATE TABLE IF NOT EXISTS rabbi_otp_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  code_hash text NOT NULL,
  salt text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rabbi_otp_phone ON rabbi_otp_codes (phone, created_at DESC);

-- ---------------------------------------------------------------------------
-- Access helpers. SECURITY DEFINER so they can read rabbi_profiles regardless of the caller's
-- own policies. Deliberately independent of every CRM helper (staff/portal/scheduler).
CREATE OR REPLACE FUNCTION public.rabbi_current_profile_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM rabbi_profiles WHERE auth_user_id = auth.uid() AND is_active LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.rabbi_is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM rabbi_profiles
    WHERE auth_user_id = auth.uid() AND role IN ('rabbi', 'assistant') AND is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.rabbi_is_rabbi()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM rabbi_profiles
    WHERE auth_user_id = auth.uid() AND role = 'rabbi' AND is_active
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS. Everything locked by default; conversations/messages/OTP are service-role-only apart
-- from an admin read on messages (the "sent messages" view + Today briefing card).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'rabbi_profiles', 'rabbi_settings', 'rabbi_categories', 'rabbi_urgency_tiers',
    'rabbi_shailos', 'rabbi_timetable_blocks', 'rabbi_slot_releases', 'rabbi_bookings',
    'rabbi_conversations', 'rabbi_messages', 'rabbi_otp_codes'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Profiles: own row read/update (role/is_active changes blocked by trigger below); admins read
-- all and update community rows. Inserts are service-role only (signup edge functions).
DROP POLICY IF EXISTS rabbi_profiles_own_select ON rabbi_profiles;
CREATE POLICY rabbi_profiles_own_select ON rabbi_profiles FOR SELECT
  USING (auth_user_id = auth.uid() OR public.rabbi_is_admin());
DROP POLICY IF EXISTS rabbi_profiles_own_update ON rabbi_profiles;
CREATE POLICY rabbi_profiles_own_update ON rabbi_profiles FOR UPDATE
  USING (auth_user_id = auth.uid() OR public.rabbi_is_admin())
  WITH CHECK (auth_user_id = auth.uid() OR public.rabbi_is_admin());

-- Role escalation guard: only the rabbi (or service role, which bypasses triggers' auth context
-- but not this check — auth.uid() is null there, allowed) may change role/is_active.
CREATE OR REPLACE FUNCTION public.rabbi_profiles_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.role IS DISTINCT FROM OLD.role OR NEW.is_active IS DISTINCT FROM OLD.is_active) THEN
    IF auth.uid() IS NOT NULL AND NOT public.rabbi_is_rabbi() THEN
      RAISE EXCEPTION 'Only the rabbi can change roles';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_rabbi_profiles_guard ON rabbi_profiles;
CREATE TRIGGER trg_rabbi_profiles_guard BEFORE UPDATE ON rabbi_profiles
  FOR EACH ROW EXECUTE FUNCTION public.rabbi_profiles_guard();

-- Settings: admin-only (community-visible derivatives are served by the rabbi-public function).
DROP POLICY IF EXISTS rabbi_settings_admin ON rabbi_settings;
CREATE POLICY rabbi_settings_admin ON rabbi_settings
  USING (public.rabbi_is_admin()) WITH CHECK (public.rabbi_is_admin());

-- Categories and urgency tiers: readable by any signed-in user (the ask-shailah form needs
-- them); writable by admins.
DROP POLICY IF EXISTS rabbi_categories_read ON rabbi_categories;
CREATE POLICY rabbi_categories_read ON rabbi_categories FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rabbi_categories_write ON rabbi_categories;
CREATE POLICY rabbi_categories_write ON rabbi_categories
  USING (public.rabbi_is_admin()) WITH CHECK (public.rabbi_is_admin());

DROP POLICY IF EXISTS rabbi_urgency_read ON rabbi_urgency_tiers;
CREATE POLICY rabbi_urgency_read ON rabbi_urgency_tiers FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rabbi_urgency_write ON rabbi_urgency_tiers;
CREATE POLICY rabbi_urgency_write ON rabbi_urgency_tiers
  USING (public.rabbi_is_admin()) WITH CHECK (public.rabbi_is_admin());

-- Shailos: community members see their own; the rabbi sees all; assistants see all EXCEPT
-- sensitive ones (niddah etc. are for the rabbi's eyes only — the user's explicit requirement).
-- Community inserts/updates go through the rabbi-public edge function (service role) so the
-- promise calculation and triage can't be bypassed.
DROP POLICY IF EXISTS rabbi_shailos_select ON rabbi_shailos;
CREATE POLICY rabbi_shailos_select ON rabbi_shailos FOR SELECT USING (
  profile_id = public.rabbi_current_profile_id()
  OR public.rabbi_is_rabbi()
  OR (public.rabbi_is_admin() AND NOT is_sensitive)
);
DROP POLICY IF EXISTS rabbi_shailos_admin_write ON rabbi_shailos;
CREATE POLICY rabbi_shailos_admin_write ON rabbi_shailos FOR UPDATE USING (
  public.rabbi_is_rabbi() OR (public.rabbi_is_admin() AND NOT is_sensitive)
) WITH CHECK (
  public.rabbi_is_rabbi() OR (public.rabbi_is_admin() AND NOT is_sensitive)
);

-- Timetable blocks: admin-managed; not visible to the community (slot maths is server-side).
DROP POLICY IF EXISTS rabbi_timetable_admin ON rabbi_timetable_blocks;
CREATE POLICY rabbi_timetable_admin ON rabbi_timetable_blocks
  USING (public.rabbi_is_admin()) WITH CHECK (public.rabbi_is_admin());

-- Slot releases: open windows readable by any signed-in user; admin RW.
DROP POLICY IF EXISTS rabbi_slots_read ON rabbi_slot_releases;
CREATE POLICY rabbi_slots_read ON rabbi_slot_releases FOR SELECT TO authenticated
  USING (status = 'open' OR public.rabbi_is_admin());
DROP POLICY IF EXISTS rabbi_slots_write_ins ON rabbi_slot_releases;
CREATE POLICY rabbi_slots_write_ins ON rabbi_slot_releases FOR INSERT
  WITH CHECK (public.rabbi_is_admin());
DROP POLICY IF EXISTS rabbi_slots_write_upd ON rabbi_slot_releases;
CREATE POLICY rabbi_slots_write_upd ON rabbi_slot_releases FOR UPDATE
  USING (public.rabbi_is_admin()) WITH CHECK (public.rabbi_is_admin());
DROP POLICY IF EXISTS rabbi_slots_write_del ON rabbi_slot_releases;
CREATE POLICY rabbi_slots_write_del ON rabbi_slot_releases FOR DELETE
  USING (public.rabbi_is_admin());

-- Bookings: community members see their own; admins see and manage all. Creation goes through
-- rabbi-public (service role) so capacity/overlap checks can't be bypassed.
DROP POLICY IF EXISTS rabbi_bookings_select ON rabbi_bookings;
CREATE POLICY rabbi_bookings_select ON rabbi_bookings FOR SELECT USING (
  profile_id = public.rabbi_current_profile_id() OR public.rabbi_is_admin()
);
DROP POLICY IF EXISTS rabbi_bookings_admin_update ON rabbi_bookings;
CREATE POLICY rabbi_bookings_admin_update ON rabbi_bookings FOR UPDATE
  USING (public.rabbi_is_admin()) WITH CHECK (public.rabbi_is_admin());

-- Messages: admins may read (briefings, sent-message history). No client writes.
DROP POLICY IF EXISTS rabbi_messages_admin_read ON rabbi_messages;
CREATE POLICY rabbi_messages_admin_read ON rabbi_messages FOR SELECT
  USING (public.rabbi_is_admin());

-- Conversations: admins may read (handed-off text conversations surface on the Today screen).
-- Writes are service-role only (the SMS webhook).
DROP POLICY IF EXISTS rabbi_conversations_admin_read ON rabbi_conversations;
CREATE POLICY rabbi_conversations_admin_read ON rabbi_conversations FOR SELECT
  USING (public.rabbi_is_admin());

-- rabbi_otp_codes: intentionally NO policies — service-role only.

-- ---------------------------------------------------------------------------
-- Seeds: categories and urgency tiers (defaults the rabbi can edit in Settings).
INSERT INTO rabbi_categories (slug, name, description, default_same_day, is_sensitive, sort_order) VALUES
  ('niddah', 'Niddah / Taharas Hamishpacha', 'Answered the same day. Handled with complete discretion.', true, true, 1),
  ('kashrus', 'Kashrus', 'Kitchen mix-ups, products, eating out.', false, false, 2),
  ('shabbos', 'Shabbos & Yom Tov', 'Muktzeh, eruv, medicines, appliances.', false, false, 3),
  ('business', 'Business & money', 'Choshen mishpat, ribbis, contracts, disputes.', false, false, 4),
  ('chinuch', 'Chinuch', 'Schooling, children, guidance for parents.', false, false, 5),
  ('shalom_bayis', 'Shalom bayis', 'Handled privately, by the Rov alone.', false, true, 6),
  ('aveilus', 'Aveilus', 'Mourning practices and related questions.', false, false, 7),
  ('simcha', 'Simchos & life events', 'Weddings, brissim, bar mitzvahs.', false, false, 8),
  ('other', 'Something else', 'Anything that does not fit the above.', false, false, 9)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO rabbi_urgency_tiers (slug, name, description, priority, promise_type, promise_hours, sort_order) VALUES
  ('urgent', 'Urgent — I need an answer today', 'Goes to the top of the queue.', 1, 'same_day', NULL, 1),
  ('soon', 'Fairly soon — within a day or two', 'Answered ahead of routine questions.', 2, 'hours', 48, 2),
  ('standard', 'No rush — whenever the Rov has time', 'Answered in turn, based on the queue.', 3, 'queue_based', NULL, 3)
ON CONFLICT (slug) DO NOTHING;
