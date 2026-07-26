import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { demoBookings, demoInvitations, demoMyShailos, isDemo } from '../../lib/demo';
import { useAuth } from '../../lib/auth';
import { OCCASION_LABELS, type Booking, type Invitation, type Shailah } from '../../types';
import { Eyebrow } from '../shared/ui';
import { Screen } from '../shared/ui';
import { fmtSlot } from '../../lib/format';

/**
 * The kehillah's home screen. Four things you can ask of the Rov, the first one weighted because
 * it is what most people come for, then where each of your own requests stands — with the promise
 * shown as a bar that fills, so "due today" is felt rather than read.
 */
function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** How far through the promised wait we are — full and red means the Rov owes it today. */
function progress(createdAt: string, dueAt: string | null): number {
  if (!dueAt) return 0;
  const start = Date.parse(createdAt);
  const end = Date.parse(dueAt);
  if (!(end > start)) return 1;
  return Math.min(1, Math.max(0.06, (Date.now() - start) / (end - start)));
}

function ActionCard({ to, icon, title, sub, tone }: {
  to: string; icon: string; title: string; sub: string; tone: 'indigo' | 'plain' | 'dark';
}) {
  return (
    <Link to={to} className={
      'rounded-xl p-4 flex items-center gap-3.5 transition-transform active:scale-[.99] ' +
      (tone === 'indigo' ? 'bg-indigo' : tone === 'dark' ? 'bg-surface border-[1.5px] border-graphite' : 'bg-surface border')
    }>
      <div className={'w-[42px] h-[42px] rounded-md grid place-items-center text-[17px] flex-none ' +
        (tone === 'indigo' ? 'bg-white/[.18] text-white' : tone === 'dark' ? 'bg-graphite text-white' : 'bg-chip')}>
        {icon}
      </div>
      <div className="flex-1 flex flex-col gap-0.5 min-w-0">
        <span className={'text-[15.5px] font-extrabold ' + (tone === 'indigo' ? 'text-white' : '')}>{title}</span>
        <span className={'text-[12px] ' + (tone === 'indigo' ? 'text-white/75' : 'text-ink-muted')}>{sub}</span>
      </div>
      <span className={'text-[17px] flex-none ' + (tone === 'indigo' ? 'text-white/80' : tone === 'dark' ? 'text-ink' : 'text-ink-ghost')}>›</span>
    </Link>
  );
}

export function HomePage() {
  const { profile, signOut } = useAuth();
  const [shailos, setShailos] = useState<Shailah[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);

  useEffect(() => {
    if (!profile) return;
    if (isDemo()) {
      setShailos(demoMyShailos);
      setBookings(demoBookings.filter((b) => b.profile_id === profile.id && Date.parse(b.starts_at) > Date.now()));
      setInvitations(demoInvitations.filter((i) => i.profile_id === profile.id));
      return;
    }
    // RLS scopes all three queries to the caller's own rows.
    supabase.from('rabbi_shailos').select('*').order('created_at', { ascending: false }).limit(5)
      .then(({ data }) => setShailos((data as Shailah[]) ?? []));
    supabase.from('rabbi_bookings').select('*').in('status', ['requested', 'confirmed'])
      .gte('starts_at', new Date().toISOString()).order('starts_at').limit(5)
      .then(({ data }) => setBookings((data as Booking[]) ?? []));
    supabase.from('rabbi_invitations').select('*').in('status', ['requested', 'accepted'])
      .gte('starts_at', new Date().toISOString()).order('starts_at').limit(5)
      .then(({ data }) => setInvitations((data as Invitation[]) ?? []));
  }, [profile]);

  // Still waiting on him, versus ready to read — an answered question belongs in one list only.
  const open = shailos.filter((s) => ['new', 'triaged', 'in_progress'].includes(s.status));
  const answered = shailos.filter((s) => s.status === 'answered');
  const anything = open.length + answered.length + bookings.length + invitations.length > 0;

  return (
    <Screen width="lg">
      <div className="flex-none bg-graphite rounded-b-[26px] md:rounded-b-none px-5 pt-5 pb-6 md:px-6 md:py-7 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-indigo-light">
            {format(new Date(), 'EEEE d MMMM')}
          </div>
          <div className="mt-1.5 text-[25px] font-extrabold leading-[1.2] text-white">
            {/* Two lines on a phone, one on a screen with room for it. */}
            {greeting()},<br className="md:hidden" />{' '}
            {profile?.full_name?.split(' ')[0] ?? 'and welcome'}
          </div>
        </div>
        <button onClick={signOut} className="text-[11.5px] font-bold text-white/40 hover:text-white/70 flex-none pt-1">
          Sign out
        </button>
      </div>

      <div className="p-3.5 md:p-6 flex flex-col gap-2.5 md:grid md:grid-cols-2 md:gap-x-5 md:items-start">
        <div className="flex flex-col gap-2.5">
          <ActionCard to="/ask" tone="indigo" icon="✦" title="Ask a shailah" sub="Only the Rov reads it" />
          {/* U+FE0E keeps ☎ as a glyph rather than a colour emoji, which would break the palette. */}
          <ActionCard to="/book/call" tone="plain" icon="☎︎" title="Book a phone call" sub="He rings you, at a time he has opened" />
          <ActionCard to="/book/meeting" tone="plain" icon="◍" title="Ask to meet" sub="Face to face · he confirms himself" />
          <ActionCard to="/invite" tone="dark" icon="✧" title="Invite the Rov to speak" sub="Simcha, shiur, organisation event" />
        </div>

        {anything && (
          <div className="contents md:flex md:flex-col md:gap-2.5">
            <div className="flex items-baseline justify-between px-1 pt-2 md:pt-0">
              <Eyebrow>Where things stand</Eyebrow>
              <Link to="/requests" className="text-[12px] font-bold text-indigo">All</Link>
            </div>

            {open.map((s) => {
              const p = progress(s.created_at, s.due_at);
              const late = p >= 1 || (s.due_at ? Date.parse(s.due_at) < Date.now() : false);
              const today = s.due_at ? new Date(s.due_at).toDateString() === new Date().toDateString() : false;
              return (
                <Link key={s.id} to={`/requests/${s.id}`} className="bg-surface border rounded-lg p-3.5 flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-extrabold truncate">Your question {s.ref}</span>
                    <span className={'ml-auto flex-none rounded-chip px-2 py-[3px] text-[10.5px] font-bold ' +
                      (late || today ? 'bg-late-bg text-late' : 'bg-chip text-ink-soft')}>
                      {late ? 'Overdue' : today ? 'Due today' : 'With the Rov'}
                    </span>
                  </div>
                  <div className="h-[5px] rounded-pill bg-chip overflow-hidden">
                    <div className={'h-full rounded-pill ' + (late || today ? 'bg-late' : 'bg-indigo')}
                      style={{ width: `${Math.round(p * 100)}%` }} />
                  </div>
                  <div className="text-[12px] leading-snug text-ink-soft">
                    {s.expected_reply_text
                      ? <>Answer expected <b>{s.expected_reply_text.replace('The Rov expects to answer ', '').replace(/\.$/, '')}</b>. We'll text you the moment it's ready.</>
                      : "The Rov has it. We'll text you the moment it's ready."}
                  </div>
                </Link>
              );
            })}

            {answered.map((s) => (
              <Link key={s.id} to={`/requests/${s.id}`} className="bg-surface border rounded-lg p-3.5 flex items-center gap-2.5">
                <span className="w-[9px] h-[9px] rounded-pill bg-good flex-none" />
                <span className="text-[13.5px] font-extrabold">The Rov has answered {s.ref}</span>
                <span className="ml-auto text-[15px] text-ink-ghost flex-none">›</span>
              </Link>
            ))}

            {bookings.map((b) => (
              <Link key={b.id} to="/requests" className="bg-surface border rounded-lg p-3.5 flex items-center gap-2.5">
                <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                  <span className="text-[13.5px] font-extrabold">
                    {b.slot_type === 'call' ? 'Phone call' : 'Meeting'} · {fmtSlot(b.starts_at)}
                  </span>
                  <span className="text-[12px] text-ink-muted">
                    {b.status === 'confirmed'
                      ? (b.slot_type === 'call' ? 'He rings you then.' : "He'll see you then.")
                      : 'Waiting on the Rov — we text you when he answers.'}
                  </span>
                </div>
                <span className={'flex-none rounded-chip px-2 py-[3px] text-[10.5px] font-bold ' +
                  (b.status === 'confirmed' ? 'bg-good-bg text-good' : 'bg-warn-bg text-warn')}>
                  {b.status === 'confirmed' ? 'Confirmed' : 'With the Rov'}
                </span>
              </Link>
            ))}

            {invitations.map((i) => (
              <Link key={i.id} to="/requests" className="bg-surface border rounded-lg p-3.5 flex items-center gap-2.5">
                <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                  <span className="text-[13.5px] font-extrabold truncate">
                    {OCCASION_LABELS[i.occasion]} · {fmtSlot(i.starts_at)}
                  </span>
                  <span className="text-[12px] text-ink-muted">
                    {i.status === 'accepted' ? 'The Rov said yes.' : 'Nothing goes in his diary until he says yes.'}
                  </span>
                </div>
                <span className={'flex-none rounded-chip px-2 py-[3px] text-[10.5px] font-bold ' +
                  (i.status === 'accepted' ? 'bg-good-bg text-good' : 'bg-warn-bg text-warn')}>
                  {i.status === 'accepted' ? 'Accepted' : 'With the Rov'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Screen>
  );
}
