import { atLocalHour, atLocalTime, computeEta, localParts } from "./rabbiEta.ts";

// Local assertions so the test runs without registry access (jsr is unreachable in some CI nets).
function assert(cond: boolean, msg = "assertion failed"): void {
  if (!cond) throw new Error(msg);
}
function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}, got ${a}`);
}

const settings = {
  timezone: "Europe/London",
  dailyShailahCapacity: 10,
  sameDayCutoffHour: 15,
  sameDayPromiseHour: 22,
};

// 2026-07-22 is a Wednesday.
const wedMorning = new Date("2026-07-22T09:00:00+01:00");
const wedEvening = new Date("2026-07-22T18:00:00+01:00");
const friMorning = new Date("2026-07-24T09:00:00+01:00");
const friEvening = new Date("2026-07-24T18:00:00+01:00");

Deno.test("same-day before cutoff promises this evening", () => {
  const r = computeEta({ now: wedMorning, tier: { promiseType: "same_day", promiseHours: null }, categorySameDay: false, queueAhead: 0, settings });
  const p = localParts(r.dueAt, settings.timezone);
  assertEquals([p.day, p.hour], [22, 22]);
  assert(r.humanText.includes("later today"));
});

Deno.test("same-day after cutoff rolls to tomorrow", () => {
  const r = computeEta({ now: wedEvening, tier: { promiseType: "same_day", promiseHours: null }, categorySameDay: false, queueAhead: 0, settings });
  assertEquals(localParts(r.dueAt, settings.timezone).day, 23);
  assert(r.humanText.includes("tomorrow"));
});

Deno.test("sensitive category forces same-day even on a standard tier", () => {
  const r = computeEta({ now: wedMorning, tier: { promiseType: "queue_based", promiseHours: null }, categorySameDay: true, queueAhead: 40, settings });
  assertEquals(localParts(r.dueAt, settings.timezone).day, 22);
});

Deno.test("same-day on Friday evening skips Shabbos to Sunday", () => {
  const r = computeEta({ now: friEvening, tier: { promiseType: "same_day", promiseHours: null }, categorySameDay: false, queueAhead: 0, settings });
  const p = localParts(r.dueAt, settings.timezone);
  assertEquals([p.day, p.weekday], [26, 0]); // Sunday 26 July 2026
});

Deno.test("hours tier lands after the given hours and avoids Shabbos", () => {
  const r = computeEta({ now: friMorning, tier: { promiseType: "hours", promiseHours: 30 }, categorySameDay: false, queueAhead: 0, settings });
  // Fri 09:00 + 30h = Sat 15:00 → rolled to Sunday.
  assertEquals(localParts(r.dueAt, settings.timezone).weekday, 0);
});

Deno.test("queue-based scales with queue depth vs capacity", () => {
  const oneDay = computeEta({ now: wedMorning, tier: { promiseType: "queue_based", promiseHours: null }, categorySameDay: false, queueAhead: 3, settings });
  assertEquals(localParts(oneDay.dueAt, settings.timezone).day, 23);
  const threeDays = computeEta({ now: wedMorning, tier: { promiseType: "queue_based", promiseHours: null }, categorySameDay: false, queueAhead: 25, settings });
  // ceil(26/10) = 3 days → Saturday 25th → rolled to Sunday 26th.
  const p = localParts(threeDays.dueAt, settings.timezone);
  assertEquals([p.day, p.weekday], [26, 0]);
});

Deno.test("atLocalHour handles DST-less winter dates too", () => {
  const winter = new Date("2026-01-14T10:00:00Z"); // Wednesday, GMT
  const d = atLocalHour(winter, "Europe/London", 1, 22);
  const p = localParts(d, "Europe/London");
  assertEquals([p.day, p.hour], [15, 22]);
});

// The weekly call pattern lands on real minutes, so atLocalTime has to be right either side of
// a clocks change — "19:00 every Sunday" must stay 19:00 in October as well as in July.
Deno.test("atLocalTime keeps the local wall clock across DST", () => {
  const TZ = "Europe/London";
  const local = (d: Date) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

  // BST: 19:00 local is 18:00Z.
  assertEquals(atLocalTime(new Date("2026-07-26T10:00:00Z"), TZ, 0, 19, 0).toISOString(), "2026-07-26T18:00:00.000Z");
  // GMT: 19:00 local is 19:00Z.
  assertEquals(atLocalTime(new Date("2026-01-11T10:00:00Z"), TZ, 0, 19, 0).toISOString(), "2026-01-11T19:00:00.000Z");
  // Minutes, not just hours.
  assertEquals(local(atLocalTime(new Date("2026-07-26T10:00:00Z"), TZ, 1, 6, 30)), "06:30");
  // The two changeover Sundays themselves.
  assertEquals(local(atLocalTime(new Date("2026-10-25T10:00:00Z"), TZ, 0, 19, 0)), "19:00");
  assertEquals(local(atLocalTime(new Date("2026-03-29T10:00:00Z"), TZ, 0, 19, 0)), "19:00");
});
