import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { isDemo } from '../../lib/demo';
import { fetchCategories, fetchSettings, fetchTiers } from '../../lib/rabbiData';
import type { Category, Settings, UrgencyTier } from '../../types';
import { BigButton, Display, Field, SectionLabel, Spinner, inputCls } from '../shared/ui';
import { useAuth } from '../../lib/auth';

// "More": the few knobs that matter, in plain words. Everything saves immediately — no forms
// with a Save button he might miss.
export function MorePage() {
  const { profile, signOut } = useAuth();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [tiers, setTiers] = useState<UrgencyTier[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    Promise.all([fetchSettings(), fetchCategories(true), fetchTiers()]).then(([s, c, t]) => {
      setSettings(s); setCats(c); setTiers(t);
    });
  }, []);

  if (!settings) return <Spinner />;

  const patch = async (fields: Partial<Settings>) => {
    setSettings({ ...settings, ...fields });
    if (isDemo()) { setSaved(true); setTimeout(() => setSaved(false), 1500); return; }
    await supabase.from('rabbi_settings').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', 1);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const toggleCategory = async (c: Category) => {
    setCats(cats.map((x) => x.id === c.id ? { ...x, is_active: !c.is_active } : x));
    if (isDemo()) return;
    await supabase.from('rabbi_categories').update({ is_active: !c.is_active }).eq('id', c.id);
  };

  return (
    <div className="flex flex-col gap-3 px-4 pt-8">
      <div className="px-1.5 flex items-start justify-between">
        <div>
          <Display className="text-[26px]">Settings</Display>
          <p className="text-[13.5px] text-ink-muted mt-1">
            {saved ? 'Saved.' : 'Changes save by themselves.'}
          </p>
        </div>
        <button onClick={signOut} className="p-2.5 text-ink-faint" aria-label="Sign out"><LogOut size={20} /></button>
      </div>

      <SectionLabel>Questions</SectionLabel>
      <div className="bg-surface rounded-xl shadow-card p-4 flex flex-col gap-4">
        <Field label="How many questions can you answer in a day?"
          hint="This drives the 'expect an answer by…' promises people are given.">
          <div className="flex gap-2">
            {[5, 10, 15, 20].map((n) => (
              <button key={n} onClick={() => patch({ daily_shailah_capacity: n })}
                className={`flex-1 rounded-lg py-3 font-extrabold text-[15px] ${settings.daily_shailah_capacity === n ? 'bg-midnight text-white' : 'bg-paper text-ink-soft'}`}>
                {n}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Same-day questions received after this time roll to the next day">
          <div className="flex gap-2">
            {[[13, '1pm'], [15, '3pm'], [17, '5pm'], [19, '7pm']].map(([h, label]) => (
              <button key={h} onClick={() => patch({ same_day_cutoff_hour: h as number })}
                className={`flex-1 rounded-lg py-3 font-extrabold text-[15px] ${settings.same_day_cutoff_hour === h ? 'bg-midnight text-white' : 'bg-paper text-ink-soft'}`}>
                {label}
              </button>
            ))}
          </div>
        </Field>
      </div>

      <SectionLabel>Question categories</SectionLabel>
      <div className="bg-surface rounded-xl shadow-card px-4 py-1">
        {cats.map((c) => (
          <div key={c.id} className="flex items-center gap-3 py-3 border-b border-separator last:border-0">
            <div className="flex-1">
              <span className="font-bold text-[15px]">{c.name}</span>
              {c.is_sensitive && <span className="text-[11.5px] text-brass-600 font-bold ml-2">private</span>}
              {c.default_same_day && <span className="text-[11.5px] text-danger-text font-bold ml-2">same day</span>}
            </div>
            <button onClick={() => toggleCategory(c)}
              className={`w-[52px] h-8 rounded-full transition-colors relative ${c.is_active !== false ? 'bg-success-text' : 'bg-separator'}`}
              aria-label={`${c.name} on or off`}>
              <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all ${c.is_active !== false ? 'left-[26px]' : 'left-1'}`} />
            </button>
          </div>
        ))}
      </div>

      <SectionLabel>Bookings</SectionLabel>
      <div className="bg-surface rounded-xl shadow-card p-4 flex flex-col gap-3">
        <ToggleRow label="Phone calls confirm by themselves"
          hint="Off means you approve every call, like meetings."
          on={settings.calls_auto_confirm}
          onToggle={() => patch({ calls_auto_confirm: !settings.calls_auto_confirm })} />
        <ToggleRow label="Meetings confirm by themselves"
          hint="Most Rabbonim keep this off and approve each one."
          on={settings.meetings_auto_confirm}
          onToggle={() => patch({ meetings_auto_confirm: !settings.meetings_auto_confirm })} />
      </div>

      <SectionLabel>Messages to you</SectionLabel>
      <div className="bg-surface rounded-xl shadow-card p-4 flex flex-col gap-4">
        <Field label="Your mobile number" hint="For the morning briefing and reminders.">
          <input className={inputCls} type="tel" defaultValue={settings.rabbi_phone ?? ''}
            onBlur={(e) => patch({ rabbi_phone: e.target.value.trim() || null })} placeholder="07123 456789" />
        </Field>
        <ToggleRow label="Morning briefing"
          hint="A short summary of your day, by text, each morning."
          on={settings.briefing_enabled}
          onToggle={() => patch({ briefing_enabled: !settings.briefing_enabled })} />
        <ToggleRow label="Text messages to the kehillah"
          hint="Booking confirmations, reminders and 'your answer is ready' texts."
          on={settings.sms_notifications_enabled}
          onToggle={() => patch({ sms_notifications_enabled: !settings.sms_notifications_enabled })} />
      </div>

      <p className="text-center text-[12.5px] text-ink-faint py-3">
        Signed in as {profile?.full_name} · {profile?.role === 'rabbi' ? 'Rov' : 'Assistant'}
      </p>
      <BigButton tone="quiet" onClick={signOut}><LogOut size={19} /> Sign out</BigButton>
      <div className="h-2" />
      {tiers.length > 0 && null /* urgency tiers are seeded server-side; editing UI can follow if needed */}
    </div>
  );
}

function ToggleRow({ label, hint, on, onToggle }: { label: string; hint?: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1">
        <div className="font-bold text-[15px]">{label}</div>
        {hint && <div className="text-[12.5px] text-ink-muted">{hint}</div>}
      </div>
      <button onClick={onToggle}
        className={`w-[52px] h-8 rounded-full transition-colors relative flex-none ${on ? 'bg-success-text' : 'bg-separator'}`}
        aria-label={label}>
        <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all ${on ? 'left-[26px]' : 'left-1'}`} />
      </button>
    </div>
  );
}
