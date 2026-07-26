-- The Rov asked for four-minute calls. Both tables capped the shortest slot at five minutes,
-- which was an arbitrary floor rather than a real constraint — he knows how long he needs.
-- Three minutes is the new floor (below that a slot is not a conversation), four hours the top.
ALTER TABLE rabbi_availability DROP CONSTRAINT IF EXISTS rabbi_availability_duration_minutes_check;
ALTER TABLE rabbi_availability ADD CONSTRAINT rabbi_availability_duration_minutes_check
  CHECK (duration_minutes BETWEEN 3 AND 240);

ALTER TABLE rabbi_slot_releases DROP CONSTRAINT IF EXISTS rabbi_slot_releases_duration_minutes_check;
ALTER TABLE rabbi_slot_releases ADD CONSTRAINT rabbi_slot_releases_duration_minutes_check
  CHECK (duration_minutes BETWEEN 3 AND 240);
