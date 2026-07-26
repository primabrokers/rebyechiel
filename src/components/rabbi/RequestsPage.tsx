import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { fetchInvitations, fetchProfilesByIds, fetchUpcomingBookings } from '../../lib/rabbiData';
import type { Booking, Invitation, Profile } from '../../types';
import { OCCASION_LABELS } from '../../types';
import { Chip, EmptyState, Mono, Panel, Spinner, type ChipTone } from '../shared/ui';
import { affiliationOf, whoOf } from '../../lib/present';

/**
 * Everything that wants a slice of his time, in one list: calls, meetings and invitations to
 * speak. Deciding happens on Today — this is the record, so he can see at a glance what he has
 * already agreed to.
 */
interface Row {
  id: string; who: string; sub: string; kind: string; detail: string;
  state: string; tone: ChipTone; when: number;
}

export function RequestsPage() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    (async () => {
      const [bookings, invitations] = await Promise.all([fetchUpcomingBookings(120), fetchInvitations()]);
      const profiles: Map<string, Profile> = await fetchProfilesByIds(
        [...bookings, ...invitations].map((x) => x.profile_id).filter(Boolean) as string[],
      );

      const bookingRow = (b: Booking): Row => ({
        id: b.id,
        who: whoOf(b, profiles),
        sub: affiliationOf(b, profiles) ?? '—',
        kind: b.slot_type === 'call' ? 'Phone call' : 'Meeting',
        detail: `${format(new Date(b.starts_at), 'EEE d MMM HH:mm')} · ${Math.round((Date.parse(b.ends_at) - Date.parse(b.starts_at)) / 60000)} min${b.purpose ? ` · ${b.purpose}` : ''}`,
        state: { requested: 'Waiting on you', confirmed: 'Confirmed', declined: 'Declined', cancelled: 'Cancelled', rescheduled: 'Moved', completed: 'Done' }[b.status],
        tone: (b.status === 'requested' ? 'warn' : b.status === 'confirmed' ? 'good' : 'neutral') as ChipTone,
        when: Date.parse(b.starts_at),
      });

      const inviteRow = (i: Invitation): Row => ({
        id: i.id,
        who: whoOf(i, profiles),
        sub: affiliationOf(i, profiles) ?? '—',
        kind: 'Invitation to speak',
        detail: `${OCCASION_LABELS[i.occasion]} · ${format(new Date(i.starts_at), 'EEE d MMM HH:mm')} · ${i.duration_minutes} min${i.location ? ` · ${i.location}` : ''}`,
        state: { requested: 'Waiting on you', accepted: 'Accepted', declined: 'Declined', cancelled: 'Cancelled' }[i.status],
        tone: (i.status === 'requested' ? 'warn' : i.status === 'accepted' ? 'good' : 'neutral') as ChipTone,
        when: Date.parse(i.starts_at),
      });

      setRows([...bookings.map(bookingRow), ...invitations.map(inviteRow)]
        // Anything still waiting on him first, then by when it happens.
        .sort((a, b) => (a.state === 'Waiting on you' ? 0 : 1) - (b.state === 'Waiting on you' ? 0 : 1) || a.when - b.when));
    })();
  }, []);

  if (!rows) return <Spinner />;

  return (
    <div className="flex flex-col gap-3.5 animate-fadeUp max-w-[1320px]">
      <span className="text-[13px] text-ink-muted">
        Anything that wants a slice of your time. Nobody is told anything until you decide — approve or decline on the Today screen.
      </span>

      {rows.length === 0 ? (
        <Panel><EmptyState title="Nothing booked or asked for" sub="Calls, meetings and invitations to speak will appear here." /></Panel>
      ) : (
        <Panel className="overflow-hidden">
          <div className="hidden lg:grid grid-cols-[220px_190px_1fr_150px] gap-3.5 px-5 py-3 bg-subtle border-b
            text-[10.5px] font-extrabold uppercase tracking-[0.09em] text-ink-muted">
            <span>Who</span><span>What they want</span><span>When</span><span>Status</span>
          </div>
          {rows.map((r) => (
            <div key={r.id} className="border-b border-hair last:border-b-0">
              <div className="hidden lg:grid grid-cols-[220px_190px_1fr_150px] gap-3.5 px-5 py-3.5 items-center">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className="text-[13.5px] font-bold truncate">{r.who}</span>
                  <Mono className="text-[11.5px]">{r.sub}</Mono>
                </div>
                <span className="text-[13px] font-semibold text-ink-soft">{r.kind}</span>
                <span className="text-[13px] text-ink-soft truncate">{r.detail}</span>
                <span className="justify-self-start"><Chip tone={r.tone}>{r.state}</Chip></span>
              </div>
              <div className="lg:hidden p-4 flex flex-col gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[14.5px] font-extrabold tracking-tight">{r.who}</span>
                  <Chip tone={r.tone}>{r.state}</Chip>
                </div>
                <span className="text-[13px] font-semibold text-ink-soft">{r.kind}</span>
                <span className="text-[13px] text-ink-muted">{r.detail}</span>
              </div>
            </div>
          ))}
        </Panel>
      )}
    </div>
  );
}
