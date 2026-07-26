import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { api } from '../../lib/api';
import { OCCASION_LABELS, type Occasion } from '../../types';
import {
  BigButton, Headline, Note, PillPick, PromisePanel, Screen, StepBar, inputCls, textareaCls,
} from '../shared/ui';

/**
 * Inviting the Rov to speak — a drasha at a simcha, a shiur, an organisation's evening. This is
 * the one request that never auto-confirms and never touches the diary: it waits until he has
 * answered it himself, and the screen says so twice because that is the whole promise.
 */
const OCCASIONS = (Object.keys(OCCASION_LABELS) as Occasion[]).map((k) => ({ key: k, label: OCCASION_LABELS[k] }));
const DURATIONS = [
  { minutes: 10, label: '10 min' },
  { minutes: 20, label: '20 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: 'Full shiur' },
];

export function InvitePage() {
  const nav = useNavigate();
  const [occasion, setOccasion] = useState<Occasion | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState(20);
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [attendance, setAttendance] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ ref: string } | null>(null);

  const startsAt = date && time ? new Date(`${date}T${time}`) : null;
  const inFuture = startsAt !== null && !Number.isNaN(startsAt.getTime()) && startsAt.getTime() > Date.now();
  // Shabbos is never bookable — the Rov's whole week is built around it.
  const onShabbos = startsAt !== null && !Number.isNaN(startsAt.getTime()) && startsAt.getDay() === 6;
  const ready = occasion !== null && inFuture && !onShabbos && location.trim().length > 2;

  const submit = async () => {
    if (!startsAt) return;
    setBusy(true); setError(null);
    try {
      const res = await api<{ invitation: { ref: string } }>('submit_invitation', {
        occasion,
        startsAt: startsAt.toISOString(),
        durationMinutes: duration,
        location: location.trim(),
        notes: notes.trim() || undefined,
        expectedAttendance: attendance ? Number(attendance) : undefined,
      });
      setDone(res.invitation);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong — please try again.');
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <Screen tone="surface" width="md">
        <div className="flex-1 px-6 md:px-7 pt-16 md:pt-12 flex flex-col gap-5">
          <div className="w-[62px] h-[62px] rounded-xl bg-graphite grid place-items-center text-[26px] text-white">✧</div>
          <Headline title={<>Your invitation is<br />with the Rov</>}
            sub="He answers these himself. You'll hear back, whichever way he decides." />
          <PromisePanel
            eyebrow="What he sees"
            headline={`${occasion ? OCCASION_LABELS[occasion] : 'Invitation'} · ${startsAt ? format(startsAt, 'EEE d MMM, HH:mm') : ''}`}
            sub={<>{duration} minutes at {location}. Your reference is <b className="font-mono">{done.ref}</b>.</>}
          />
        </div>
        <div className="px-5 md:px-7 pb-7 md:pb-8">
          <BigButton onClick={() => nav('/')}>Back to home</BigButton>
        </div>
      </Screen>
    );
  }

  return (
    <Screen tone="surface" width="md">
      <StepBar onBack={() => nav('/')} steps={2} at={1} />

      <div className="px-5 md:px-7 py-4 flex flex-col gap-3.5">
        <Headline title="Invite the Rov to speak" sub="He answers these himself — you'll hear back, whichever way." />

        <div className="flex flex-col gap-2">
          <span className="text-[12.5px] font-bold text-ink-soft">What's the occasion?</span>
          <PillPick value={occasion} options={OCCASIONS} onPick={setOccasion} />
        </div>

        <div className="md:grid md:grid-cols-2 md:gap-x-5 flex flex-col gap-3.5">
        <div className="flex flex-col gap-3.5">
        <div className="flex gap-2.5">
          <label className="flex-1 flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-ink-soft">Date</span>
            <input className={inputCls + ' font-mono !text-[14px] font-semibold'} type="date"
              min={format(new Date(), 'yyyy-MM-dd')} value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="flex-1 flex flex-col gap-1.5">
            <span className="text-[12.5px] font-bold text-ink-soft">Time</span>
            <input className={inputCls + ' font-mono !text-[14px] font-semibold'} type="time"
              value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>

        {onShabbos && (
          <Note icon="✦">That's Shabbos. Pick another day — the Rov's week is built around it.</Note>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-[12.5px] font-bold text-ink-soft">Roughly how long?</span>
          <div className="flex gap-1.5 flex-wrap">
            {DURATIONS.map((d) => (
              <button key={d.minutes} type="button" onClick={() => setDuration(d.minutes)}
                className={'rounded-ctl px-3 py-2 text-[12px] font-bold transition-colors ' +
                  (duration === d.minutes ? 'bg-graphite text-white' : 'bg-chip text-ink-soft')}>
                {d.label}
              </button>
            ))}
          </div>
        </div>

        </div>

        <div className="flex flex-col gap-3.5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-ink-soft">Where is it?</span>
          <input className={inputCls} placeholder="e.g. Simcha hall, 14 Cheltenham Cres"
            value={location} onChange={(e) => setLocation(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-ink-soft">Anything he should know</span>
          <textarea className={textareaCls + ' min-h-[76px] text-[13.5px]'}
            placeholder="Sheva brochos for my daughter — the family would be honoured."
            value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-bold text-ink-soft">Roughly how many people? (optional)</span>
          <input className={inputCls + ' font-mono'} type="number" inputMode="numeric" min={1} placeholder="60"
            value={attendance} onChange={(e) => setAttendance(e.target.value.replace(/\D/g, ''))} />
        </label>

        </div>
        </div>

        <Note>
          Nothing is held for you yet. If it clashes with his shiur or a chosson lesson, he sees that the
          moment he opens it — and he'll tell you either way.
        </Note>
      </div>

      <div className="mt-auto px-5 md:px-7 pt-3 pb-7 md:pb-8 flex flex-col gap-2">
        {error && <p className="text-[13px] font-bold text-late text-center">{error}</p>}
        <BigButton busy={busy} disabled={!ready} onClick={submit}>Send the invitation</BigButton>
        <span className="text-[11.5px] text-center text-ink-muted">Nothing goes in his diary until he says yes.</span>
      </div>
    </Screen>
  );
}
