import { useState } from 'react';
import { addDays, format } from 'date-fns';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { isDemo } from '../../lib/demo';
import { slotsInWindow, type Availability } from '../../types';
import { Btn, Field, Portal, inputCls } from '../shared/ui';

/**
 * Opening times for calls and meetings.
 *
 * The Rov's week repeats — calls after Maariv on a Sunday, half an hour on a Wednesday night —
 * so the default is a time he keeps EVERY week: set it once and the kehillah can book it for as
 * long as he leaves it on. One-off extra times and "I'm away that day" are the two exceptions,
 * kept behind the same sheet but never the first thing he has to think about.
 */
type Mode = 'weekly' | 'once' | 'away';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

/** One tap for the patterns Rabbonim actually keep, so he never starts from a blank form. */
const PRESETS: { label: string; sub: string; weekday: number; from: string; to: string; minutes: number }[] = [
  { label: 'Sunday after Maariv', sub: '19:00–20:00 · six calls', weekday: 0, from: '19:00', to: '20:00', minutes: 10 },
  { label: 'Weeknight half hour', sub: 'Wednesday 21:00–21:30 · three calls', weekday: 3, from: '21:00', to: '21:30', minutes: 10 },
  { label: 'Before Shacharis', sub: 'Monday 06:30–07:00 · three calls', weekday: 1, from: '06:30', to: '07:00', minutes: 10 },
];

export function OpenTimesSheet({ onClose, onSaved }: { onClose: () => void; onSaved: (m: string) => void }) {
  const [mode, setMode] = useState<Mode>('weekly');
  const [slotType, setSlotType] = useState<'call' | 'meeting'>('call');
  const [weekday, setWeekday] = useState(0);
  const [from, setFrom] = useState('19:00');
  const [to, setTo] = useState('20:00');
  const [duration, setDuration] = useState(10);
  const [location, setLocation] = useState('');
  const [date, setDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [awayDate, setAwayDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'));
  const [awayReason, setAwayReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The only number he cares about: how many people this lets in.
  const count = slotsInWindow({ start_time: from, end_time: to, duration_minutes: duration } as Availability);
  const noun = slotType === 'call' ? (count === 1 ? 'call' : 'calls') : (count === 1 ? 'meeting' : 'meetings');

  const applyPreset = (p: typeof PRESETS[number]) => {
    setSlotType('call'); setWeekday(p.weekday); setFrom(p.from); setTo(p.to); setDuration(p.minutes);
  };

  const save = async () => {
    setBusy(true); setError(null);
    try {
      if (mode === 'away') {
        if (isDemo()) { onSaved('Noted — nothing will be offered that day.'); return; }
        const { error: err } = await supabase.from('rabbi_time_off')
          .insert({ on_date: awayDate, reason: awayReason.trim() || null });
        if (err) {
          setError(err.message.includes('duplicate') ? 'That day is already marked.' : err.message);
          return;
        }
        onSaved(`Nothing will be offered on ${format(new Date(`${awayDate}T12:00:00`), 'EEEE d MMMM')}.`);
        return;
      }

      if (to <= from) { setError('The end time must be after the start.'); return; }
      if (count < 1) { setError(`That window is shorter than ${duration} minutes — nobody could book it.`); return; }
      if (isDemo()) { onSaved('Saved.'); return; }

      if (mode === 'weekly') {
        const { error: err } = await supabase.from('rabbi_availability').insert({
          slot_type: slotType, weekday, start_time: from, end_time: to,
          duration_minutes: duration,
          location: slotType === 'meeting' ? (location.trim() || null) : null,
        });
        if (err) { setError(err.message); return; }
        onSaved(`Every ${WEEKDAYS[weekday]} from now on — ${count} ${noun}, and you needn't do it again.`);
      } else {
        if (new Date(`${date}T${from}:00`).getDay() === 6) {
          setError('That is Shabbos — pick another day.');
          return;
        }
        const { error: err } = await supabase.from('rabbi_slot_releases').insert({
          slot_type: slotType,
          starts_at: new Date(`${date}T${from}:00`).toISOString(),
          ends_at: new Date(`${date}T${to}:00`).toISOString(),
          duration_minutes: duration,
          location: slotType === 'meeting' ? (location.trim() || null) : null,
        });
        if (err) { setError(err.message); return; }
        onSaved(`${count} extra ${noun} on ${format(new Date(`${date}T12:00:00`), 'EEEE d MMMM')} — open now.`);
      }
    } finally { setBusy(false); }
  };

  const TABS: { key: Mode; label: string }[] = [
    { key: 'weekly', label: 'Every week' },
    { key: 'once', label: 'Just this once' },
    { key: 'away', label: "I'm away" },
  ];

  return (
    <Portal>
      <div onClick={onClose} className="fixed inset-0 z-40 bg-graphite-deep/40" />
      <aside className="fixed top-0 right-0 bottom-0 z-50 w-full sm:w-[460px] bg-surface flex flex-col shadow-drawer animate-slideIn">
        <header className="px-6 py-5 border-b flex items-center">
          <span className="text-[17px] font-extrabold tracking-tight flex-1">Open times</span>
          <button onClick={onClose} aria-label="Close"
            className="w-8 h-8 rounded-ctl grid place-items-center text-ink-muted hover:bg-canvas">
            <X size={16} />
          </button>
        </header>

        <div className="px-6 pt-4 flex gap-1.5">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => { setMode(t.key); setError(null); }}
              className={clsx('flex-1 rounded-ctl py-2.5 text-[13px] font-bold border transition-colors',
                mode === t.key ? 'bg-graphite text-white border-graphite' : 'bg-canvas text-ink-soft')}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto px-6 py-5 flex flex-col gap-4">
          {mode === 'away' ? (
            <>
              <p className="text-[13px] leading-relaxed text-ink-soft">
                Nothing is offered on a day you're away — your weekly times simply don't run.
                Anything already booked stays booked, so you can see it and ring to move it.
              </p>
              <Field label="Which day?">
                <input type="date" className={inputCls} min={format(new Date(), 'yyyy-MM-dd')}
                  value={awayDate} onChange={(e) => setAwayDate(e.target.value)} />
              </Field>
              <Field label="Why? (only you see this)">
                <input className={inputCls} placeholder="e.g. Away for a chasunah"
                  value={awayReason} onChange={(e) => setAwayReason(e.target.value)} />
              </Field>
            </>
          ) : (
            <>
              <div className="flex gap-2">
                {(['call', 'meeting'] as const).map((t) => (
                  <button key={t} onClick={() => { setSlotType(t); setDuration(t === 'call' ? 10 : 30); }}
                    className={clsx('flex-1 rounded-ctl py-3 text-[14px] font-bold border transition-colors',
                      slotType === t ? 'bg-graphite text-white border-graphite' : 'bg-canvas text-ink-soft')}>
                    {t === 'call' ? 'Phone calls' : 'Meetings'}
                  </button>
                ))}
              </div>

              {mode === 'weekly' ? (
                <>
                  <div className="flex flex-col gap-2">
                    <span className="text-[12.5px] font-bold text-ink-soft">Start from one of these</span>
                    <div className="flex flex-col gap-1.5">
                      {PRESETS.map((p) => (
                        <button key={p.label} onClick={() => applyPreset(p)}
                          className="rounded-ctl border border-firm bg-canvas px-3.5 py-2.5 text-left hover:bg-chip transition-colors">
                          <div className="text-[13.5px] font-bold">{p.label}</div>
                          <div className="text-[11.5px] text-ink-muted">{p.sub}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <Field label="Which day, every week?">
                    <div className="flex gap-1.5 flex-wrap">
                      {WEEKDAYS.map((d, i) => (
                        <button key={d} onClick={() => setWeekday(i)}
                          className={clsx('rounded-pill px-3.5 py-2 text-[12.5px] font-extrabold border transition-colors',
                            weekday === i ? 'bg-graphite text-white border-graphite' : 'bg-canvas text-ink-soft')}>
                          {d.slice(0, 3)}
                        </button>
                      ))}
                    </div>
                  </Field>
                </>
              ) : (
                <Field label="Which day?" hint="A one-off, on top of your weekly times.">
                  <input type="date" className={inputCls} min={format(new Date(), 'yyyy-MM-dd')}
                    value={date} onChange={(e) => setDate(e.target.value)} />
                </Field>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="From">
                  <input type="time" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
                </Field>
                <Field label="Until">
                  <input type="time" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
                </Field>
              </div>

              <Field label="Minutes per person">
                <div className="flex gap-2">
                  {(slotType === 'call' ? [5, 10, 15] : [15, 30, 45]).map((m) => (
                    <button key={m} onClick={() => setDuration(m)}
                      className={clsx('flex-1 rounded-ctl py-3 text-[14px] font-bold border transition-colors',
                        duration === m ? 'bg-graphite text-white border-graphite' : 'bg-canvas text-ink-soft')}>
                      {m}
                    </button>
                  ))}
                </div>
              </Field>

              {slotType === 'meeting' && (
                <Field label="Where (optional)">
                  <input className={inputCls} placeholder="e.g. Shul office"
                    value={location} onChange={(e) => setLocation(e.target.value)} />
                </Field>
              )}

              {/* The whole point, in one sentence: how many people this lets in. */}
              <div className="rounded-md border border-indigo/30 bg-indigo-soft px-4 py-3.5">
                <span className="text-[13.5px] leading-snug text-indigo-ink">
                  {count < 1 ? (
                    <>That window is too short for {duration}-minute {slotType === 'call' ? 'calls' : 'meetings'}.</>
                  ) : mode === 'weekly' ? (
                    <><b>{count} {noun} every {WEEKDAYS[weekday]}</b>, {from} to {to}. It keeps running until you turn it off.</>
                  ) : (
                    <><b>{count} {noun}</b> on {format(new Date(`${date}T12:00:00`), 'EEEE d MMMM')}, {from} to {to}.</>
                  )}
                </span>
              </div>
            </>
          )}

          {error && <p className="text-[12.5px] font-bold text-late">{error}</p>}
        </div>

        <footer className="px-6 py-4 border-t">
          <Btn tone="dark" busy={busy} className="w-full py-3.5 text-[14.5px]" onClick={save}
            disabled={mode !== 'away' && count < 1}>
            {mode === 'weekly' ? 'Keep this every week' : mode === 'once' ? 'Open these times' : 'Mark me away'}
          </Btn>
        </footer>
      </aside>
    </Portal>
  );
}
