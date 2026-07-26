import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { api } from '../../lib/api';
import { fetchAnswered, fetchCategories, fetchProfilesByIds, fetchQueue, fetchTiers } from '../../lib/rabbiData';
import type { Category, Profile, Shailah, UrgencyTier } from '../../types';
import { AFFILIATION_LABELS } from '../../types';
import { BigButton, Display, EmptyState, Pill, Spinner } from '../shared/ui';
import { fmtDue } from '../../lib/format';
import { useAuth } from '../../lib/auth';

// One list, already sorted: overdue/urgent first (due_at ascending). Each card: who, what,
// due chip, AI suggestion with one-tap confirm, and a single big Answer button.
export function QueuePage() {
  const nav = useNavigate();
  const { profile } = useAuth();
  const [tab, setTab] = useState<'open' | 'answered'>('open');
  const [queue, setQueue] = useState<Shailah[] | null>(null);
  const [answered, setAnswered] = useState<Shailah[] | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [tiers, setTiers] = useState<UrgencyTier[]>([]);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [confirming, setConfirming] = useState<string | null>(null);

  const load = async () => {
    const [q, a, c, t] = await Promise.all([fetchQueue(), fetchAnswered(), fetchCategories(true), fetchTiers()]);
    setQueue(q); setAnswered(a); setCats(c); setTiers(t);
    setProfiles(await fetchProfilesByIds([...q, ...a].map((s) => s.profile_id).filter(Boolean) as string[]));
  };
  useEffect(() => { load(); }, []);

  if (!queue || !answered) return <Spinner />;

  const catName = (id: string | null) => cats.find((c) => c.id === id)?.name ?? null;
  const tierName = (id: string | null) => tiers.find((t) => t.id === id)?.name ?? null;
  const who = (s: Shailah) =>
    s.is_sensitive ? 'Private matter'
      : (s.profile_id && profiles.get(s.profile_id)?.full_name) || s.contact_name || 'Text-in caller';
  const affOf = (s: Shailah) => {
    const a = s.profile_id ? profiles.get(s.profile_id)?.affiliation : null;
    return a ? AFFILIATION_LABELS[a] : s.channel === 'sms' ? 'By text' : null;
  };

  // One-tap confirm of the AI's suggestion (or of the asker's own choice if AI agreed).
  const confirmTriage = async (s: Shailah) => {
    setConfirming(s.id);
    try {
      await api('confirm_triage', {
        shailahId: s.id,
        categoryId: s.ai_suggested_category_id ?? s.category_id,
        urgencyTierId: s.ai_suggested_urgency_id ?? s.urgency_tier_id,
      });
      await load();
    } finally { setConfirming(null); }
  };

  const list = tab === 'open' ? queue : answered;

  return (
    <div className="flex flex-col gap-3 px-4 md:px-8 lg:px-10 pt-8 md:max-w-6xl">
      <div className="px-1.5">
        <Display className="text-[26px]">Questions</Display>
        <p className="text-[13.5px] text-ink-muted mt-1">Sorted for you — urgent first.</p>
      </div>

      <div className="flex gap-2 px-1">
        <button onClick={() => setTab('open')}
          className={`rounded-full px-4 py-2 text-[13.5px] font-extrabold ${tab === 'open' ? 'bg-midnight text-white' : 'bg-surface shadow-card text-ink-soft'}`}>
          To answer ({queue.length})
        </button>
        <button onClick={() => setTab('answered')}
          className={`rounded-full px-4 py-2 text-[13.5px] font-extrabold ${tab === 'answered' ? 'bg-midnight text-white' : 'bg-surface shadow-card text-ink-soft'}`}>
          Answered
        </button>
      </div>

      {list.length === 0 && (
        <EmptyState title={tab === 'open' ? 'Nothing waiting — enjoy the quiet' : 'No answered questions yet'} />
      )}

      {/* Cards sit two-up from lg so a tablet or desktop scans the queue in half the scrolling. */}
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4 lg:items-start">
      {list.map((s) => {
        const due = fmtDue(s.due_at);
        const needsTriageConfirm = tab === 'open' && !s.triage_confirmed_at &&
          (s.ai_suggested_category_id || s.ai_suggested_urgency_id) &&
          !(profile?.role === 'assistant' && s.is_sensitive);
        return (
          <div key={s.id}
            className={`bg-surface rounded-xl shadow-card p-4 flex flex-col gap-2.5 ${due.tone === 'danger' && tab === 'open' ? 'priority-spine pl-5' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="font-extrabold text-[17px] tracking-tight">{who(s)}</span>
              {tab === 'open'
                ? <Pill tone={due.tone === 'danger' ? 'bad' : due.tone === 'warning' ? 'warn' : 'info'}>{due.label}</Pill>
                : <Pill tone="ok">Answered</Pill>}
            </div>
            {!s.is_sensitive && (
              <p className="text-[14px] text-ink-soft line-clamp-2">{s.ai_summary ?? s.question}</p>
            )}
            {s.is_sensitive && tab === 'open' && (
              <p className="text-[14px] text-ink-soft">Details shown only when you open it</p>
            )}
            <div className="flex gap-1.5 flex-wrap items-center">
              {catName(s.category_id) && <Pill tone="brass">{catName(s.category_id)}</Pill>}
              {affOf(s) && <Pill tone="info">{affOf(s)}</Pill>}
              {tierName(s.urgency_tier_id) && due.tone !== 'danger' && <Pill tone="warn">{tierName(s.urgency_tier_id)?.split(' — ')[0]}</Pill>}
            </div>
            {needsTriageConfirm && (
              <button onClick={() => confirmTriage(s)} disabled={confirming === s.id}
                className="flex items-center gap-2 text-[13.5px] font-bold text-success-text bg-success-bg rounded-lg px-3 py-2.5 disabled:opacity-50">
                <Check size={17} strokeWidth={3} />
                Suggested: {catName(s.ai_suggested_category_id ?? s.category_id) ?? 'as asked'}
                {(s.ai_suggested_urgency_id || s.urgency_tier_id) && ` · ${tierName(s.ai_suggested_urgency_id ?? s.urgency_tier_id)?.split(' — ')[0]}`}
                {' — tap to confirm'}
              </button>
            )}
            {tab === 'open'
              ? <BigButton onClick={() => nav(`/rabbi/answer/${s.id}`)}>Answer</BigButton>
              : <BigButton tone="quiet" onClick={() => nav(`/rabbi/answer/${s.id}`)}>View</BigButton>}
          </div>
        );
      })}
      </div>
    </div>
  );
}
