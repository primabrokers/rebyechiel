-- Recurring call/meeting times for Rabbi Emanuel's Assistant.
--
-- Until now the only way to open times was rabbi_slot_releases: one window, on one date, created
-- by hand. In practice the Rov's week repeats — calls after Maariv on a Sunday, half an hour on
-- a Wednesday night — so he was re-entering the same thing every week and, when he forgot, the
-- kehillah found nothing to book. This adds the pattern he actually keeps (modelled on the
-- scheduler in Prima CRM), leaving one-off releases for genuine exceptions.
--
-- rabbi_availability   — "every Sunday, 19:00–20:00, ten minutes each"
-- rabbi_time_off       — "I'm away on the 14th" (beats the pattern, offers nothing that day)

CREATE TABLE IF NOT EXISTS rabbi_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_type text NOT NULL CHECK (slot_type IN ('call', 'meeting')),
  weekday int NOT NULL CHECK (weekday BETWEEN 0 AND 5), -- 0 = Sunday. Never Shabbos.
  start_time time NOT NULL,
  end_time time NOT NULL,
  duration_minutes int NOT NULL DEFAULT 10 CHECK (duration_minutes BETWEEN 5 AND 120),
  location text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES rabbi_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_rabbi_availability_day
  ON rabbi_availability (weekday, slot_type) WHERE is_active;

-- A single date on which the weekly pattern does not run. Nothing is offered, and anything
-- already booked stays booked — cancelling a booking is a separate, deliberate act.
CREATE TABLE IF NOT EXISTS rabbi_time_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  on_date date NOT NULL UNIQUE,
  reason text,
  created_by uuid REFERENCES rabbi_profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rabbi_time_off_date ON rabbi_time_off (on_date);

ALTER TABLE rabbi_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE rabbi_time_off ENABLE ROW LEVEL SECURITY;

-- Same shape as rabbi_slot_releases: any signed-in user may read the live pattern (the app shows
-- "Sunday evening open" on the home screen), only an admin may change it. The actual slot maths
-- still runs server-side in rabbi-public, so reading this can't be used to book something closed.
DROP POLICY IF EXISTS rabbi_availability_read ON rabbi_availability;
CREATE POLICY rabbi_availability_read ON rabbi_availability FOR SELECT TO authenticated
  USING (is_active OR public.rabbi_is_admin());
DROP POLICY IF EXISTS rabbi_availability_ins ON rabbi_availability;
CREATE POLICY rabbi_availability_ins ON rabbi_availability FOR INSERT
  WITH CHECK (public.rabbi_is_admin());
DROP POLICY IF EXISTS rabbi_availability_upd ON rabbi_availability;
CREATE POLICY rabbi_availability_upd ON rabbi_availability FOR UPDATE
  USING (public.rabbi_is_admin()) WITH CHECK (public.rabbi_is_admin());
DROP POLICY IF EXISTS rabbi_availability_del ON rabbi_availability;
CREATE POLICY rabbi_availability_del ON rabbi_availability FOR DELETE
  USING (public.rabbi_is_admin());

DROP POLICY IF EXISTS rabbi_time_off_read ON rabbi_time_off;
CREATE POLICY rabbi_time_off_read ON rabbi_time_off FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rabbi_time_off_ins ON rabbi_time_off;
CREATE POLICY rabbi_time_off_ins ON rabbi_time_off FOR INSERT WITH CHECK (public.rabbi_is_admin());
DROP POLICY IF EXISTS rabbi_time_off_del ON rabbi_time_off;
CREATE POLICY rabbi_time_off_del ON rabbi_time_off FOR DELETE USING (public.rabbi_is_admin());

GRANT SELECT ON rabbi_availability, rabbi_time_off TO authenticated;
GRANT INSERT, UPDATE, DELETE ON rabbi_availability, rabbi_time_off TO authenticated;

-- A starting pattern so the kehillah has something to book on day one: ten-minute calls on a
-- Sunday evening, and half-hour meetings on a Tuesday evening. He can change or clear both.
INSERT INTO rabbi_availability (slot_type, weekday, start_time, end_time, duration_minutes, location)
SELECT * FROM (VALUES
  ('call', 0, '19:00'::time, '20:00'::time, 10, NULL::text),
  ('meeting', 2, '20:00'::time, '21:30'::time, 30, 'Shul office')
) AS seed(slot_type, weekday, start_time, end_time, duration_minutes, location)
WHERE NOT EXISTS (SELECT 1 FROM rabbi_availability);
