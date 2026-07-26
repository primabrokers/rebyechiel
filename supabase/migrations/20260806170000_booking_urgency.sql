-- A call about a levaya tomorrow and a call about a business matter are not the same request.
-- Questions have carried an urgency since the start; the things people actually ring about did
-- not, so the Rov saw a list of times with no sense of which to make first.
ALTER TABLE public.rabbi_bookings
  ADD COLUMN IF NOT EXISTS urgency_tier_id uuid REFERENCES public.rabbi_urgency_tiers(id);

CREATE INDEX IF NOT EXISTS idx_rabbi_bookings_urgency
  ON public.rabbi_bookings (urgency_tier_id) WHERE urgency_tier_id IS NOT NULL;
