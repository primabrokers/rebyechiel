import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import {
  fetchAnswered, fetchCategories, fetchProfilesByIds, fetchQueue, fetchTiers,
} from '../../lib/rabbiData';
import type { Category, Profile, Shailah, UrgencyTier } from '../../types';
import { Chip, EmptyState, Mono, Panel, Spinner, Toast } from '../shared/ui';
import { affiliationOf, dueChip, whoOf } from '../../lib/present';
import { AnswerDrawer } from './AnswerDrawer';
import { useAuth } from '../../lib/auth';

type Filter = 'open' | 'answered' | 'private' | 'texted';

/**
 * Every shailah as one table. A table rather than cards because the point here is comparison —
 * who is waiting longest, what he promised — and clicking a row opens the answer drawer without
 * losing his place. Narrow screens fall back to stacked cards.
 */
export function QueuePage() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('open');
  const [open, setOpen] = useState<Shailah[] | null>(null);
  const [answered, setAnswered] = useState<Shailah[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [tiers, setTiers] = useState<UrgencyTier[]>([]);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [toast, setToast] = useState<string | null>(null);

  const load = async () => {
    const [q, a, c, t] = await Promise.all([fetchQueue(), fetchAnswered(), fetchCategories(true), fetchTiers()]);
    setOpen(q); setAnswered(a); setCats(c); setTiers(t);
    setProfiles(await fetchProfilesByIds([...q, ...a].map((s) => s.profile_id).filter(Boolean) as string[]));
  };
  useEffect(() => { load(); }, []);

  const all = useMemo(() => [...(open ?? []), ...answered], [open, answered]);
  const selectedId = params.get('open');
  const selected = all.find((s) => s.id === selectedId) ?? null;

  if (!open) return <Spinner />;

  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? null;
  const rows = {
    open, answered,
    private: all.filter((s) => s.is_sensitive),
    texted: all.filter((s) => s.channel === 'sms'),
  }[filter];

  // An assistant never sees a sensitive shailah, so the filter is meaningless for them.
  const filters: { key: Filter; label: string }[] = [
    { key: 'open', label: `Open (${open.length})` },
    { key: 'answered', label: 'Answered' },
    ...(profile?.role === 'rabbi' ? [{ key: 'private' as const, label: 'Private only' }] : []),
    { key: 'texted', label: 'Texted in' },
  ];

  const openRow = (s: Shailah) => setParams({ open: s.id }, { replace: true });
  const closeDrawer = () => setParams({}, { replace: true });

  return (
    <div className="flex flex-col gap-4 animate-fadeUp max-w-[1320px]">
      <div className="flex gap-2 items-center flex-wrap">
        {filters.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={clsx('rounded-ctl px-3.5 py-2 text-[13px] font-bold border transition-colors',
              filter === f.key ? 'bg-graphite text-white border-graphite' : 'bg-surface text-ink-soft')}>
            {f.label}
          </button>
        ))}
        <span className="ml-auto text-[12.5px] text-ink-muted hidden sm:block">
          Soonest promise first — the top row is the one to do next.
        </span>
      </div>

      {rows.length === 0 && (
        <Panel><EmptyState title={filter === 'open' ? 'Nothing waiting — enjoy the quiet' : 'Nothing here'} /></Panel>
      )}

      {rows.length > 0 && (
        <Panel className="overflow-hidden">
          {/* Desktop table */}
          <div className="hidden lg:grid grid-cols-[190px_1fr_150px_170px_120px] gap-3.5 px-5 py-3
            bg-subtle border-b text-[10.5px] font-extrabold uppercase tracking-[0.09em] text-ink-muted">
            <span>Who asked</span><span>What it's about</span><span>Category</span><span>You promised</span><span>Status</span>
          </div>
          {rows.map((s) => {
            const d = dueChip(s.due_at);
            const isDone = ['answered', 'closed'].includes(s.status);
            const who = s.is_sensitive && !isDone ? 'Private matter' : whoOf(s, profiles);
            const summary = s.is_sensitive ? 'A private matter — details open only for you.' : (s.ai_summary ?? s.question);
            const promise = s.expected_reply_text
              ? s.expected_reply_text.replace('The Rov expects to answer ', '').replace(/\.$/, '')
              : '—';
            return (
              <div key={s.id} onClick={() => openRow(s)}
                className="border-b border-hair last:border-b-0 cursor-pointer transition-colors hover:bg-subtle">
                {/* Desktop row */}
                <div className="hidden lg:grid grid-cols-[190px_1fr_150px_170px_120px] gap-3.5 px-5 py-3.5 items-center">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-[13.5px] font-bold truncate">{who}</span>
                    <Mono>{s.ref} · {s.channel === 'sms' ? 'texted in' : 'in the app'}</Mono>
                  </div>
                  <span className="text-[13.5px] text-ink-soft truncate">{summary}</span>
                  <span className="text-[12.5px] text-ink-soft">{catName(s.category_id) ?? '—'}</span>
                  <span className={clsx('text-[12.5px] font-semibold', d.tone === 'late' && !isDone ? 'text-late' : 'text-ink-soft')}>
                    {isDone ? '—' : promise}
                  </span>
                  <span className="justify-self-start">
                    {isDone ? <Chip tone="good">Answered</Chip> : <Chip tone={d.tone}>{d.label}</Chip>}
                  </span>
                </div>
                {/* Phone / tablet card */}
                <div className="lg:hidden p-4 flex flex-col gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[14.5px] font-extrabold tracking-tight">{who}</span>
                    {isDone ? <Chip tone="good">Answered</Chip> : <Chip tone={d.tone}>{d.label}</Chip>}
                    <Mono className="ml-auto">{s.ref}</Mono>
                  </div>
                  <span className="text-[13.5px] text-ink-soft line-clamp-2">{summary}</span>
                  <div className="flex gap-1.5 flex-wrap">
                    {catName(s.category_id) && <Chip>{catName(s.category_id)}</Chip>}
                    {affiliationOf(s, profiles) && <Chip tone="indigo">{affiliationOf(s, profiles)}</Chip>}
                  </div>
                </div>
              </div>
            );
          })}
        </Panel>
      )}

      {selected && (
        <AnswerDrawer
          shailah={selected}
          categories={cats}
          tiers={tiers}
          onClose={closeDrawer}
          onDone={async (msg) => {
            closeDrawer();
            setToast(msg);
            setTimeout(() => setToast(null), 3200);
            await load();
          }}
        />
      )}
      {toast && <Toast message={toast} />}
    </div>
  );
}
