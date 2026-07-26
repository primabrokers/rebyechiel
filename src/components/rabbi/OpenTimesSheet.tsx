import { useMemo, useState } from 'react';
import { addDays, format } from 'date-fns';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { isDemo } from '../../lib/demo';
import type { Availability, CalendarDay, SlotRelease, TimetableBlock } from '../../types';
import { Btn, Portal, inputCls } from '../shared/ui';

/**
 * Opening times, by ticking them.
 *
 * The old sheet asked for a window and a duration and left him to picture the result. This shows
 * the actual times — a fortnight of them, a day at a time — and he ticks the ones he'll take.
 * Times his fixed week already occupies are not offered; Shabbos and yom tov are not offered;
 * an erev stops before candle-lighting. What he ticks is what the kehillah gets.
 *
 * Ticks are coalesced back into windows on save, so "19:00, 19:10, 19:20" becomes one 19:00–19:30
 * row rather than three, and "Every Sunday · 6 calls" still reads as a sentence.
 */
const DAYS_SHOWN = 14;

/** He asked for four-minute calls, so the presets go where he asked and Custom takes the rest. */
const CALL_MINUTES = [4, 5, 10, 15, 20];
const MEETING_MINUTES = [20, 30, 45, 60];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const hhmm = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
const pad = (n: number) => String(n).padStart(2, '0');
const asTime = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const dateKey = (d: Date) => format(d, 'yyyy-MM-dd');

interface Candidate { key: string; date: string; minute: number; label: string }

export function OpenTimesSheet({ blocks, weekly, releases, calendar, onClose, onSaved }: {
  blocks: TimetableBlock[];
  weekly: Availability[];
  releases: SlotRelease[];
  calendar: Map<string, CalendarDay>;
  onClose: () => void;
  onSaved: (m: string) => void;
}) {
  const [slotType, setSlotType] = useState<'call' | 'meeting'>('call');
  const [duration, setDuration] = useState(10);
  const [customMins, setCustomMins] = useState('');
  const [dayFrom, setDayFrom] = useState('07:00');
  const [dayTo, setDayTo] = useState('22:00');
  const [location, setLocation] = useState('');
  const [repeat, setRepeat] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bespokeDate, setBespokeDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [bespokeTime, setBespokeTime] = useState('');
  const [bespoke, setBespoke] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const minutesList = slotType === 'call' ? CALL_MINUTES : MEETING_MINUTES;

  /**
   * A fortnight of tickable times. Everything already spoken for is left out rather than shown
   * and disabled — a grid of greyed-out chips is noise, and he only wants what he can offer.
   */
  const days = useMemo(() => {
    const out: { date: string; heading: string; note: string | null; times: Candidate[] }[] = [];
    const startMin = hhmm(dayFrom);
    const endMin = hhmm(dayTo);
    for (let i = 0; i < DAYS_SHOWN; i++) {
      const d = addDays(new Date(), i);
      const date = dateKey(d);
      const wd = d.getDay();
      const cal = calendar.get(date);
      if (wd === 6 || cal?.no_work) {
        out.push({ date, heading: format(d, 'EEE d MMM').toUpperCase(), note: cal?.label ?? 'Shabbos', times: [] });
        continue;
      }
      // On an erev, stop before candles — an appointment in the run-up is not a real offer.
      const candlesMin = cal?.candles_at
        ? new Date(cal.candles_at).getHours() * 60 + new Date(cal.candles_at).getMinutes() - 30
        : null;
      const dayBlocks = blocks.filter((b) => b.weekday === wd && b.is_active);
      const dayWeekly = weekly.filter((a) => a.weekday === wd && a.is_active);
      const dayReleases = releases.filter(
        (r) => r.status === 'open' && dateKey(new Date(r.starts_at)) === date,
      );
      const times: Candidate[] = [];
      for (let m = startMin; m + duration <= endMin; m += duration) {
        if (candlesMin !== null && m + duration > candlesMin) break;
        if (i === 0) {
          const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
          if (m < nowMin + 60) continue;                      // an hour's notice, as everywhere else
        }
        const clash = dayBlocks.some((b) => m < hhmm(b.end_time) && m + duration > hhmm(b.start_time));
        if (clash) continue;
        const alreadyWeekly = dayWeekly.some((a) => m >= hhmm(a.start_time) && m < hhmm(a.end_time));
        const alreadyOnce = dayReleases.some((r) => {
          const s = new Date(r.starts_at); const e = new Date(r.ends_at);
          const sm = s.getHours() * 60 + s.getMinutes();
          const em = e.getHours() * 60 + e.getMinutes();
          return m >= sm && m < em;
        });
        if (alreadyWeekly || alreadyOnce) continue;
        times.push({ key: `${date}T${asTime(m)}`, date, minute: m, label: asTime(m) });
      }
      out.push({
        date, heading: format(d, 'EEE d MMM').toUpperCase(),
        note: cal?.candles_at ? `candles ${format(new Date(cal.candles_at), 'HH:mm')}` : null,
        times,
      });
    }
    return out;
  }, [blocks, weekly, releases, calendar, duration, dayFrom, dayTo]);

  const allCandidates = useMemo(
    () => [...days.flatMap((d) => d.times), ...bespoke],
    [days, bespoke],
  );
  const chosen = useMemo(
    () => allCandidates.filter((c) => picked.has(c.key)).sort((a, b) => a.key.localeCompare(b.key)),
    [allCandidates, picked],
  );

  const toggle = (k: string) => setPicked((p) => {
    const n = new Set(p);
    if (n.has(k)) n.delete(k); else n.add(k);
    return n;
  });
  const toggleDay = (date: string) => setPicked((p) => {
    const dayKeys = days.find((d) => d.date === date)?.times.map((t) => t.key) ?? [];
    const all = dayKeys.every((k) => p.has(k));
    const n = new Set(p);
    for (const k of dayKeys) { if (all) n.delete(k); else n.add(k); }
    return n;
  });

  const addBespoke = () => {
    if (!bespokeTime) { setError('Pick a time first.'); return; }
    const key = `${bespokeDate}T${bespokeTime}`;
    if (allCandidates.some((c) => c.key === key)) { setPicked((p) => new Set(p).add(key)); return; }
    setBespoke((b) => [...b, { key, date: bespokeDate, minute: hhmm(bespokeTime), label: bespokeTime }]);
    setPicked((p) => new Set(p).add(key));
    setBespokeTime(''); setError(null);
  };

  /**
   * Consecutive ticks on the same day become one window. Three ten-minute ticks at 19:00 are
   * 19:00–19:30, not three rows he has to read one at a time.
   */
  const coalesce = (items: Candidate[]) => {
    const runs: { date: string; from: number; to: number }[] = [];
    for (const c of items) {
      const last = runs.length ? runs[runs.length - 1] : undefined;
      if (last && last.date === c.date && last.to === c.minute) last.to = c.minute + duration;
      else runs.push({ date: c.date, from: c.minute, to: c.minute + duration });
    }
    return runs;
  };

  const save = async () => {
    if (!chosen.length) { setError('Tick at least one time.'); return; }
    setBusy(true); setError(null);
    try {
      const runs = coalesce(chosen);
      const loc = slotType === 'meeting' ? (location.trim() || null) : null;
      if (isDemo()) { onSaved(`${chosen.length} times opened.`); return; }

      if (repeat) {
        // The weekday of each run becomes the pattern; identical runs on the same weekday
        // (two Sundays ticked the same way) collapse to one rule.
        const seen = new Set<string>();
        const rows = runs.flatMap((r) => {
          const weekday = new Date(`${r.date}T12:00:00`).getDay();
          const id = `${weekday}-${r.from}-${r.to}`;
          if (seen.has(id)) return [];
          seen.add(id);
          return [{
            slot_type: slotType, weekday, start_time: asTime(r.from), end_time: asTime(r.to),
            duration_minutes: duration, location: loc,
          }];
        });
        const { error: err } = await supabase.from('rabbi_availability').insert(rows);
        if (err) { setError(err.message); return; }
        const perWeek = rows.reduce((n, r) => n + (hhmm(r.end_time) - hhmm(r.start_time)) / duration, 0);
        const dayNames = [...new Set(rows.map((r) => WEEKDAYS[r.weekday]))].join(', ');
        onSaved(`Every ${dayNames} from now on — ${perWeek} a week, and you needn't do it again.`);
      } else {
        const rows = runs.map((r) => ({
          slot_type: slotType,
          starts_at: new Date(`${r.date}T${asTime(r.from)}:00`).toISOString(),
          ends_at: new Date(`${r.date}T${asTime(r.to)}:00`).toISOString(),
          duration_minutes: duration, location: loc,
        }));
        const { error: err } = await supabase.from('rabbi_slot_releases').insert(rows);
        if (err) { setError(err.message); return; }
        onSaved(`${chosen.length} ${slotType === 'call' ? 'calls' : 'meetings'} open, on ${runs.length === 1 ? 'one day' : `${new Set(runs.map((r) => r.date)).size} days`}.`);
      }
    } finally { setBusy(false); }
  };

  return (
    <Portal>
      <div onClick={onClose} className="fixed inset-0 z-40 bg-graphite-deep/40" />
      <aside className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[620px] bg-surface flex flex-col shadow-drawer animate-slideIn">
        <header className="px-6 py-5 border-b flex items-center">
          <span className="text-[17px] font-extrabold tracking-tight flex-1">Open times to book</span>
          <button onClick={onClose} aria-label="Close"
            className="w-8 h-8 rounded-ctl grid place-items-center text-ink-muted hover:bg-canvas">
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-4">
          <div className="flex gap-2">
            {(['call', 'meeting'] as const).map((t) => (
              <button key={t}
                onClick={() => { setSlotType(t); setDuration(t === 'call' ? 10 : 30); setPicked(new Set()); }}
                className={clsx('flex-1 rounded-ctl py-3 text-[14px] font-bold border transition-colors',
                  slotType === t ? 'bg-graphite text-white border-graphite' : 'bg-canvas text-ink-soft')}>
                {t === 'call' ? 'Phone calls' : 'Meetings'}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[12.5px] font-bold text-ink-soft">How long is each one?</span>
            <div className="flex gap-1.5 flex-wrap items-center">
              {minutesList.map((m) => (
                <button key={m} onClick={() => { setDuration(m); setCustomMins(''); setPicked(new Set()); }}
                  className={clsx('rounded-ctl px-3.5 py-2.5 text-[13px] font-bold border transition-colors',
                    duration === m && !customMins ? 'bg-graphite text-white border-graphite' : 'bg-canvas text-ink-soft')}>
                  {m} min
                </button>
              ))}
              <input
                className={inputCls + ' !w-[92px] font-mono !text-[13px] !py-2.5'}
                type="number" min={3} max={240} placeholder="Custom"
                value={customMins}
                onChange={(e) => {
                  setCustomMins(e.target.value);
                  const n = Number(e.target.value);
                  if (n >= 3 && n <= 240) { setDuration(n); setPicked(new Set()); }
                }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-bold text-ink-soft">Show times from</span>
              <input type="time" className={inputCls} value={dayFrom}
                onChange={(e) => { setDayFrom(e.target.value); setPicked(new Set()); }} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-bold text-ink-soft">until</span>
              <input type="time" className={inputCls} value={dayTo}
                onChange={(e) => { setDayTo(e.target.value); setPicked(new Set()); }} />
            </label>
          </div>

          {slotType === 'meeting' && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-bold text-ink-soft">Where (optional)</span>
              <input className={inputCls} placeholder="e.g. Shul office"
                value={location} onChange={(e) => setLocation(e.target.value)} />
            </label>
          )}

          <div className="rounded-md border border-dashed border-strong bg-canvas px-3.5 py-3 flex items-center gap-2.5 flex-wrap">
            <span className="text-[12.5px] font-bold text-ink-soft">A time that isn't listed:</span>
            <input type="date" className={inputCls + ' !w-auto !py-2 !text-[13px]'} min={format(new Date(), 'yyyy-MM-dd')}
              value={bespokeDate} onChange={(e) => setBespokeDate(e.target.value)} />
            <input type="time" className={inputCls + ' !w-auto !py-2 !text-[13px]'}
              value={bespokeTime} onChange={(e) => setBespokeTime(e.target.value)} />
            <Btn tone="dark" onClick={addBespoke}>Add it</Btn>
          </div>

          <div className="flex items-baseline gap-2 pt-1">
            <span className="text-[13px] font-extrabold">
              Tick the times to offer
            </span>
            <span className="text-[12.5px] text-ink-muted">({chosen.length} ticked)</span>
            {chosen.length > 0 && (
              <button className="ml-auto text-[12.5px] font-bold text-indigo" onClick={() => setPicked(new Set())}>
                Clear
              </button>
            )}
          </div>

          <div className="rounded-md border max-h-[420px] overflow-auto divide-y divide-hair">
            {days.map((d) => {
              const allOn = d.times.length > 0 && d.times.every((t) => picked.has(t.key));
              const dayBespoke = bespoke.filter((b) => b.date === d.date);
              return (
                <div key={d.date} className="px-3.5 py-3 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-ink-muted">
                      {d.heading}
                    </span>
                    {d.note && <span className="text-[11px] text-warn">{d.note}</span>}
                    {d.times.length > 0 && (
                      <button onClick={() => toggleDay(d.date)}
                        className="ml-auto text-[11.5px] font-bold text-indigo">
                        {allOn ? 'None' : `All ${d.times.length}`}
                      </button>
                    )}
                  </div>
                  {d.times.length === 0 && !dayBespoke.length ? (
                    <span className="text-[12px] text-ink-faint">
                      {d.note && d.note !== null && !d.note.startsWith('candles') ? 'Nothing is offered.' : 'No free times in that range.'}
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {[...d.times, ...dayBespoke].map((t) => (
                        <button key={t.key} onClick={() => toggle(t.key)}
                          className={clsx('rounded-ctl px-3 py-2 font-mono text-[12.5px] font-semibold border transition-colors',
                            picked.has(t.key)
                              ? 'bg-graphite text-white border-graphite'
                              : 'bg-surface border-firm text-ink-soft hover:bg-canvas')}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {error && <p className="text-[12.5px] font-bold text-late">{error}</p>}
        </div>

        <footer className="px-6 py-4 border-t flex flex-col gap-3">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" className="mt-[3px] w-4 h-4 accent-[#12141a]"
              checked={repeat} onChange={(e) => setRepeat(e.target.checked)} />
            <span className="flex flex-col gap-0.5">
              <span className="text-[13.5px] font-bold">Keep these every week</span>
              <span className="text-[12px] leading-snug text-ink-muted">
                {repeat
                  ? 'The same times, the same day each week, until you turn them off.'
                  : 'These exact dates only — a one-off.'}
              </span>
            </span>
          </label>
          <Btn tone="dark" busy={busy} disabled={!chosen.length}
            className="w-full py-3.5 text-[14.5px]" onClick={save}>
            {chosen.length
              ? `Open ${chosen.length} ${slotType === 'call' ? 'call' : 'meeting'}${chosen.length === 1 ? '' : 's'}${repeat ? ' every week' : ''}`
              : 'Tick some times'}
          </Btn>
        </footer>
      </aside>
    </Portal>
  );
}
