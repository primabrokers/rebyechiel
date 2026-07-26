import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, isToday } from 'date-fns';
import { api } from '../../lib/api';
import {
  fetchCategories, fetchLatestBriefing, fetchPendingInvitations, fetchPendingMeetings,
  fetchProfilesByIds, fetchQueue, fetchTimetable, fetchUpcomingBookings, findClash,
} from '../../lib/rabbiData';
import type { Booking, Category, Invitation, Profile, Shailah, TimetableBlock } from '../../types';
import { OCCASION_LABELS } from '../../types';
import { Btn, Chip, Dot, Mono, Panel, SectionHead, Spinner, Toast, type ChipTone } from '../shared/ui';
import { affiliationOf, dueChip, whoOf } from '../../lib/present';

/**
 * The console's landing screen. Three signals across the top say the shape of the day before he
 * reads a word; the briefing repeats what he was texted at 06:40; then the two things that
 * actually need him — questions promised for today, and requests nobody has been answered about.
 */
export function TodayPage() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [queue, setQueue] = useState<Shailah[]>([]);
  const [meetings, setMeetings] = useState<Booking[]>([]);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [blocks, setBlocks] = useState<TimetableBlock[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [briefing, setBriefing] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const say = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3200); };

  const load = async () => {
    const [q, m, i, b, t, c, br] = await Promise.all([
      fetchQueue(), fetchPendingMeetings(), fetchPendingInvitations(), fetchUpcomingBookings(1),
      fetchTimetable(), fetchCategories(true), fetchLatestBriefing(),
    ]);
    setQueue(q); setMeetings(m); setInvites(i); setBookings(b); setBlocks(t); setCats(c); setBriefing(br);
    setProfiles(await fetchProfilesByIds([
      ...q.map((x) => x.profile_id), ...m.map((x) => x.profile_id),
      ...i.map((x) => x.profile_id), ...b.map((x) => x.profile_id),
    ].filter(Boolean) as string[]));
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  if (loading) return <Spinner />;

  const now = new Date();
  const weekday = now.getDay();
  const dueToday = queue.filter((s) => s.due_at && (new Date(s.due_at) <= now || isToday(new Date(s.due_at))));
  const todaysBookings = bookings.filter((b) => isToday(new Date(b.starts_at)) && b.status === 'confirmed');
  const pendingCount = meetings.length + invites.length;
  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? null;

  const act = async (kind: 'booking' | 'invitation', id: string, ok: boolean, msg: string) => {
    setBusyId(id);
    try {
      if (kind === 'booking') await api('set_booking_status', { bookingId: id, status: ok ? 'confirmed' : 'declined' });
      else await api('set_invitation_status', { invitationId: id, status: ok ? 'accepted' : 'declined' });
      say(msg);
      await load();
    } finally { setBusyId(null); }
  };

  const signals: { label: string; n: number; unit: string; tone: ChipTone; hint: string; go: () => void }[] = [
    {
      label: 'Answer today', n: dueToday.length, tone: 'late',
      unit: dueToday.length === 1 ? 'question' : 'questions',
      hint: dueToday.length ? 'These people were promised an answer before tonight.' : 'Nothing is owed today.',
      go: () => nav('/rabbi/questions'),
    },
    {
      label: 'In the diary', n: todaysBookings.length, tone: 'indigo',
      unit: todaysBookings.length === 1 ? 'appointment' : 'appointments',
      hint: todaysBookings.length
        ? `${whoOf(todaysBookings[0], profiles)}, ${format(new Date(todaysBookings[0].starts_at), 'HH:mm')}. They get a reminder text an hour before.`
        : 'Nothing booked today.',
      go: () => nav('/rabbi/diary'),
    },
    {
      label: 'Waiting for your OK', n: pendingCount, tone: 'warn',
      unit: pendingCount === 1 ? 'request' : 'requests',
      hint: pendingCount ? 'Nobody has been told anything yet.' : 'Nothing waiting — everyone has had their answer.',
      go: () => nav('/rabbi/requests'),
    },
  ];

  return (
    <div className="flex flex-col gap-5 animate-fadeUp max-w-[1320px]">
      <div className="grid gap-3.5 sm:grid-cols-3">
        {signals.map((s) => (
          <Panel key={s.label} onClick={s.go} className="p-4 flex flex-col gap-2.5">
            <div className="flex items-center gap-2">
              <Dot tone={s.tone} />
              <span className="text-[11px] font-extrabold uppercase tracking-[0.09em] text-ink-muted">{s.label}</span>
            </div>
            <div className="flex items-baseline gap-2.5">
              <span className={`text-[34px] leading-none font-extrabold tabular-nums ${s.n && s.tone === 'late' ? 'text-late' : 'text-ink'}`}>{s.n}</span>
              <span className="text-[13px] text-ink-soft">{s.unit}</span>
            </div>
            <div className="text-[12.5px] leading-snug text-ink-muted">{s.hint}</div>
          </Panel>
        ))}
      </div>

      {briefing && (
        <div className="bg-graphite rounded-lg p-5 flex gap-5 items-start">
          <div className="w-10 h-10 rounded-md bg-indigo/25 grid place-items-center text-[17px] text-indigo-light flex-none">◈</div>
          <div className="flex-1 flex flex-col gap-2 min-w-0">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.1em] text-indigo-light">Your morning briefing</span>
              <span className="font-mono text-[10.5px] font-medium text-white/35">also texted to you</span>
            </div>
            <div className="text-[14.5px] leading-relaxed text-white/85 max-w-[820px] whitespace-pre-line">{briefing}</div>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr] items-start">
        <div className="flex flex-col gap-3">
          <SectionHead
            title="Needs you today"
            sub="Sorted by what you promised the person"
            action={<button onClick={() => nav('/rabbi/questions')} className="text-[12.5px] font-bold text-indigo">See all questions →</button>}
          />
          <div className="flex flex-col gap-2.5">
            {dueToday.length === 0 && (
              <Panel className="p-5 text-[13.5px] text-ink-muted">Nothing promised for today. Anything new appears here.</Panel>
            )}
            {dueToday.map((s) => {
              const d = dueChip(s.due_at);
              return (
                <Panel key={s.id} onClick={() => nav(`/rabbi/questions?open=${s.id}`)}
                  className="p-4 pl-5 flex flex-col gap-2.5 relative overflow-hidden">
                  <span className="absolute left-0 inset-y-0 w-1"
                    style={{ background: d.tone === 'late' ? '#c93b2b' : d.tone === 'warn' ? '#a9700f' : '#79828f' }} />
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="text-[15px] font-extrabold tracking-tight">
                      {s.is_sensitive ? 'Private matter' : whoOf(s, profiles)}
                    </span>
                    <Chip tone={d.tone}>{d.label}</Chip>
                    {catName(s.category_id) && <Chip>{catName(s.category_id)}</Chip>}
                    <Mono className="ml-auto">{s.ref}</Mono>
                  </div>
                  <div className="text-[14px] leading-snug text-ink-soft max-w-[560px]">
                    {s.is_sensitive ? 'A private matter — details open only for you.' : (s.ai_summary ?? s.question)}
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="text-[12px] text-ink-muted">
                      {s.expected_reply_text
                        ? `You promised: ${s.expected_reply_text.replace('The Rov expects to answer ', '').replace(/\.$/, '')}`
                        : ''}
                    </span>
                    <span className="ml-auto text-[12.5px] font-bold text-indigo">Answer it →</span>
                  </div>
                </Panel>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <Panel className="p-4 flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[14px] font-extrabold tracking-tight">Waiting for your OK</span>
              <span className="text-[12px] text-ink-muted">Nobody is told anything until you decide.</span>
            </div>

            {pendingCount === 0 && (
              <div className="rounded-md border border-good/25 bg-good-bg p-3.5 text-[13px] leading-snug text-good-deep">
                Nothing waiting — everyone has had their answer.
              </div>
            )}

            {meetings.map((b) => (
              <div key={b.id} className="border rounded-md p-3.5 flex flex-col gap-2.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14px] font-extrabold tracking-tight">{whoOf(b, profiles)} — meeting</span>
                  {affiliationOf(b, profiles) && <Chip>{affiliationOf(b, profiles)}</Chip>}
                </div>
                <div className="text-[13px] leading-snug text-ink-soft">
                  {format(new Date(b.starts_at), 'EEEE HH:mm')} · {Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000)} min
                  {b.purpose ? ` · “${b.purpose}”` : ''}
                </div>
                <div className="flex gap-2">
                  <Btn tone="good" busy={busyId === b.id} className="flex-1"
                    onClick={() => act('booking', b.id, true, `${whoOf(b, profiles)} has been texted — it's in your diary.`)}>Yes, book it</Btn>
                  <Btn busy={busyId === b.id} className="flex-1"
                    onClick={() => act('booking', b.id, false, `${whoOf(b, profiles)} has been told, and asked to choose another time.`)}>Can't make it</Btn>
                </div>
              </div>
            ))}

            {invites.map((inv) => {
              const clash = findClash(inv.starts_at, inv.duration_minutes, blocks);
              return (
                <div key={inv.id} className="rounded-md border border-indigo/30 bg-indigo-softer p-3.5 flex flex-col gap-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14px] font-extrabold tracking-tight">{whoOf(inv, profiles)} — invitation to speak</span>
                    <Chip tone="indigo">{OCCASION_LABELS[inv.occasion]}</Chip>
                  </div>
                  <div className="text-[13px] leading-snug text-ink-soft">
                    {format(new Date(inv.starts_at), 'EEEE d MMMM, HH:mm')} · {inv.duration_minutes} min
                    {inv.location ? ` · ${inv.location}` : ''}
                    {inv.expected_attendance ? ` · about ${inv.expected_attendance} people` : ''}
                  </div>
                  {clash && (
                    <div className="flex items-start gap-2 rounded-ctl bg-warn-bg px-3 py-2.5">
                      <span className="text-[12px] text-warn flex-none">▲</span>
                      <span className="text-[12.5px] leading-snug text-warn-ink">
                        Your {clash.label.toLowerCase()} is at {clash.start_time.slice(0, 5)} that day — it's tight.
                      </span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Btn tone="good" busy={busyId === inv.id} className="flex-1"
                      onClick={() => act('invitation', inv.id, true, `${whoOf(inv, profiles)} has been texted — it's in your diary.`)}>Yes, I'll come</Btn>
                    <Btn busy={busyId === inv.id} className="flex-1"
                      onClick={() => act('invitation', inv.id, false, `${whoOf(inv, profiles)} has been told you cannot make it.`)}>Not this time</Btn>
                  </div>
                </div>
              );
            })}
          </Panel>

          <Panel className="p-4 flex flex-col gap-3">
            <div className="flex flex-col gap-0.5">
              <span className="text-[14px] font-extrabold tracking-tight">{format(now, 'EEEE')}</span>
              <span className="text-[12px] text-ink-muted">Your fixed times, plus anything booked.</span>
            </div>
            <div className="flex flex-col">
              {[
                ...blocks.filter((b) => b.weekday === weekday).map((b) => ({
                  key: `b-${b.id}`, time: b.start_time.slice(0, 5), label: b.label,
                  sub: `Until ${b.end_time.slice(0, 5)} — nothing can be booked`, booked: false,
                })),
                ...todaysBookings.map((b) => ({
                  key: `k-${b.id}`, time: format(new Date(b.starts_at), 'HH:mm'),
                  label: `${b.slot_type === 'call' ? 'Phone call' : 'Meeting'} — ${whoOf(b, profiles)}`,
                  sub: b.purpose ?? `${Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000)} min`,
                  booked: true,
                })),
              ].sort((a, b) => a.time.localeCompare(b.time)).map((row) => (
                <div key={row.key} className="flex gap-3 py-2.5 border-t border-hair items-start first:border-t-0">
                  <span className="w-[42px] flex-none font-mono text-[12.5px] font-bold text-ink pt-px">{row.time}</span>
                  <span className={`w-[9px] h-[9px] flex-none rounded-pill mt-1 ${row.booked ? 'bg-indigo' : 'bg-ink-ghost'}`} />
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[13.5px] font-bold">{row.label}</span>
                    <span className="text-[12px] text-ink-muted">{row.sub}</span>
                  </div>
                </div>
              ))}
              {blocks.filter((b) => b.weekday === weekday).length === 0 && todaysBookings.length === 0 && (
                <span className="text-[13px] text-ink-muted py-2">Nothing fixed today. Set your week up in the Diary.</span>
              )}
            </div>
          </Panel>
        </div>
      </div>

      {toast && <Toast message={toast} />}
    </div>
  );
}
