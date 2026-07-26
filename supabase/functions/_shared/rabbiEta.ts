// Expected-reply-time calculator for Rabbi Emanuel's Assistant.
//
// Deterministic on purpose: the promise we make to the asker ("The Rov expects to answer by
// Tuesday evening") must be reproducible and auditable, so no AI is involved here. The AI only
// suggests WHICH tier applies; this module turns a tier into a date and a sentence.
//
// Promises never land on Shabbos: anything that would fall on a Saturday rolls to Sunday.
// (Proper yom tov / zmanim awareness is a planned follow-up; Saturday is the hard floor.)

export interface EtaSettings {
  timezone: string; // e.g. 'Europe/London'
  dailyShailahCapacity: number;
  sameDayCutoffHour: number; // local hour after which "same day" rolls to tomorrow
  sameDayPromiseHour: number; // local hour a same-day promise points at
}

export interface EtaTier {
  promiseType: "same_day" | "hours" | "queue_based";
  promiseHours: number | null;
}

export interface EtaResult {
  dueAt: Date;
  humanText: string; // e.g. "The Rov expects to answer by tomorrow evening."
}

interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  weekday: number; // 0 = Sunday … 6 = Saturday
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function localParts(date: Date, tz: string): LocalParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit",
    weekday: "short", hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) parts[p.type] = p.value;
  const wdMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour === "24" ? "0" : parts.hour),
    weekday: wdMap[parts.weekday] ?? 0,
  };
}

// Timezone offset (ms) of tz at the given instant. The double-format trick is the standard
// dependency-free approach; accurate to the minute, which is ample for reply promises.
function tzOffsetMs(ts: number, tz: string): number {
  const d = new Date(ts);
  const utc = new Date(d.toLocaleString("en-US", { timeZone: "UTC" }));
  const loc = new Date(d.toLocaleString("en-US", { timeZone: tz }));
  return loc.getTime() - utc.getTime();
}

// The UTC instant of (local calendar day of `base` + dayOffset) at local hour:minute in tz.
export function atLocalTime(base: Date, tz: string, dayOffset: number, hour: number, minute = 0): Date {
  const p = localParts(base, tz);
  // Work off UTC noon of the local calendar date to avoid DST-boundary day slips.
  const dayUtcNoon = Date.UTC(p.year, p.month - 1, p.day + dayOffset, 12);
  const guess = Date.UTC(p.year, p.month - 1, p.day + dayOffset, hour, minute);
  const withOffset = guess - tzOffsetMs(dayUtcNoon, tz);
  // One refinement pass in case the offset differs at the target instant itself.
  return new Date(guess - tzOffsetMs(withOffset, tz));
}

/** Whole-hour form, which is all the promise engine ever needs. */
export function atLocalHour(base: Date, tz: string, dayOffset: number, hour: number): Date {
  return atLocalTime(base, tz, dayOffset, hour, 0);
}

function rollOffShabbos(due: Date, tz: string, promiseHour: number): Date {
  let result = due;
  while (localParts(result, tz).weekday === 6) {
    result = atLocalHour(result, tz, 1, promiseHour);
  }
  return result;
}

function describeDay(due: Date, now: Date, tz: string): string {
  const dueP = localParts(due, tz);
  const nowP = localParts(now, tz);
  const dayDiff = Math.round(
    (Date.UTC(dueP.year, dueP.month - 1, dueP.day) - Date.UTC(nowP.year, nowP.month - 1, nowP.day)) / 86_400_000,
  );
  const timeOfDay = dueP.hour >= 18 ? "evening" : dueP.hour >= 12 ? "afternoon" : "morning";
  if (dayDiff <= 0) return `later today (by this ${timeOfDay})`;
  if (dayDiff === 1) return `by tomorrow ${timeOfDay}`;
  if (dayDiff < 7) return `by ${WEEKDAYS[dueP.weekday]} ${timeOfDay}`;
  return `within ${dayDiff} days`;
}

export function computeEta(opts: {
  now: Date;
  tier: EtaTier;
  categorySameDay: boolean;
  queueAhead: number; // open shailos already in the queue
  settings: EtaSettings;
}): EtaResult {
  const { now, tier, categorySameDay, queueAhead, settings } = opts;
  const tz = settings.timezone;
  const promiseHour = settings.sameDayPromiseHour;
  let due: Date;

  if (categorySameDay || tier.promiseType === "same_day") {
    // Same day, unless it arrived after the cutoff — then the promise is tomorrow.
    const p = localParts(now, tz);
    const dayOffset = p.hour >= settings.sameDayCutoffHour ? 1 : 0;
    due = atLocalHour(now, tz, dayOffset, promiseHour);
  } else if (tier.promiseType === "hours") {
    due = new Date(now.getTime() + (tier.promiseHours ?? 24) * 3_600_000);
  } else {
    // Queue-based: how many working days until this question's turn comes up.
    const days = Math.max(1, Math.ceil((queueAhead + 1) / Math.max(1, settings.dailyShailahCapacity)));
    due = atLocalHour(now, tz, days, promiseHour);
  }

  due = rollOffShabbos(due, tz, promiseHour);
  return { dueAt: due, humanText: `The Rov expects to answer ${describeDay(due, now, tz)}.` };
}
