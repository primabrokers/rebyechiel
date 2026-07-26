-- The Jewish calendar, from Hebcal, cached per day.
--
-- Until now the only calendar rule in the app was "never Saturday". That is not good enough: a
-- shailah promised for the second day of Sukkos, or a phone call offered at 19:00 on erev Pesach,
-- is a promise the Rov cannot keep. This caches Hebcal's answer for each date — what yom tov it
-- is, when candles are lit, when Shabbos or yom tov ends, and the day's zmanim — so the promise
-- engine and the slot maths can both be honest without calling an API on every request.
--
-- Refreshed nightly by the rabbi-calendar edge function (and on demand when the location
-- changes). Nothing here is authoritative halacha: it is Hebcal's published times for the
-- configured location, shown so the Rov can see what the app is assuming.

-- Where the times are calculated for. Manchester by default; any Hebcal geonameid works, and
-- lat/long are kept so the zmanim call can be made without a second lookup.
ALTER TABLE rabbi_settings
  ADD COLUMN IF NOT EXISTS location_name text NOT NULL DEFAULT 'Manchester, United Kingdom',
  ADD COLUMN IF NOT EXISTS location_geonameid int NOT NULL DEFAULT 2643123,
  ADD COLUMN IF NOT EXISTS location_latitude numeric(9,6) NOT NULL DEFAULT 53.481020,
  ADD COLUMN IF NOT EXISTS location_longitude numeric(9,6) NOT NULL DEFAULT -2.236790,
  -- Outside Israel, so two days of yom tov. Hebcal's `i=on` flips this.
  ADD COLUMN IF NOT EXISTS in_israel boolean NOT NULL DEFAULT false,
  -- How long before candle-lighting the diary stops offering appointments.
  ADD COLUMN IF NOT EXISTS erev_cutoff_minutes int NOT NULL DEFAULT 90
    CHECK (erev_cutoff_minutes BETWEEN 0 AND 480),
  ADD COLUMN IF NOT EXISTS calendar_synced_at timestamptz;

CREATE TABLE IF NOT EXISTS rabbi_calendar_days (
  on_date date PRIMARY KEY,
  /** 'weekday' | 'erev' (candles are lit tonight) | 'shabbos' | 'yomtov' | 'chol_hamoed' | 'fast' */
  kind text NOT NULL DEFAULT 'weekday'
    CHECK (kind IN ('weekday', 'erev', 'shabbos', 'yomtov', 'chol_hamoed', 'fast')),
  /** What to call it in plain words: "Second day Sukkos", "Erev Pesach", "Shabbos Chazon". */
  label text,
  /** The parsha, on a Shabbos. */
  parsha text,
  /** Work is forbidden — nothing may be promised for, offered on, or texted on this day. */
  no_work boolean NOT NULL DEFAULT false,
  /** Local candle-lighting, on an erev. Appointments stop before this. */
  candles_at timestamptz,
  /** Local havdalah / end of yom tov. */
  havdalah_at timestamptz,
  /** Hebcal's zmanim for the day, as returned: alotHaShachar, sunrise, sofZmanShma, … */
  zmanim jsonb,
  hebrew_date text,
  synced_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rabbi_calendar_no_work ON rabbi_calendar_days (on_date) WHERE no_work;

ALTER TABLE rabbi_calendar_days ENABLE ROW LEVEL SECURITY;

-- The calendar is public knowledge: any signed-in user may read it (the community app shows
-- "the Rov has stopped for yom tov"). Only the service role writes, from rabbi-calendar.
DROP POLICY IF EXISTS rabbi_calendar_read ON rabbi_calendar_days;
CREATE POLICY rabbi_calendar_read ON rabbi_calendar_days FOR SELECT TO authenticated USING (true);

GRANT SELECT ON rabbi_calendar_days TO authenticated;

-- Nightly refresh, and a top-up every few hours so a fresh install fills in without waiting for
-- midnight. The function is idempotent: it upserts the same rows.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rabbi-calendar-nightly') THEN
    PERFORM cron.unschedule('rabbi-calendar-nightly');
  END IF;
  PERFORM cron.schedule(
    'rabbi-calendar-nightly',
    '20 2 * * *',
    $cmd$ SELECT public.trigger_edge_function('rabbi-calendar'); $cmd$
  );
END $$;
