import type { Profile } from '../types';
import type { ChipTone } from '../components/shared/ui';

/**
 * Small presentation helpers shared by the console screens, so "who is this" and "how late is
 * this" are answered the same way everywhere.
 */

/** Anyone who can appear on a request: an app member, or someone who only ever texted in. */
export interface HasContact {
  profile_id: string | null;
  contact_name?: string | null;
}

export function whoOf(row: HasContact, profiles: Map<string, Profile>): string {
  return (row.profile_id && profiles.get(row.profile_id)?.full_name) || row.contact_name || 'Text-in caller';
}

/** How the Rov's affiliation chip should read — the mosad's own name beats the category. */
export function affiliationOf(row: HasContact, profiles: Map<string, Profile>): string | null {
  const p = row.profile_id ? profiles.get(row.profile_id) : null;
  if (!p) return 'By text';
  if (p.organisation) return p.organisation;
  return p.affiliation
    ? { shul_member: 'Shul member', beis_hatalmud: 'Beis Hatalmud', mosdos: 'Mosdos', other: 'Other' }[p.affiliation]
    : null;
}

/** The due chip: red today or overdue, amber tomorrow, plain after that. */
export function dueChip(dueAt: string | null): { label: string; tone: ChipTone } {
  if (!dueAt) return { label: 'No date', tone: 'neutral' };
  const d = new Date(dueAt);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  if (d < now) return { label: 'Overdue', tone: 'late' };
  if (days <= 0) return { label: 'Due today', tone: 'late' };
  if (days === 1) return { label: 'Due tomorrow', tone: 'warn' };
  return { label: d.toLocaleDateString('en-GB', { weekday: 'long' }), tone: 'neutral' };
}
