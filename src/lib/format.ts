import { format, isToday, isTomorrow, isPast } from 'date-fns';

export function fmtSlot(iso: string): string {
  const d = new Date(iso);
  if (isToday(d)) return `Today ${format(d, 'HH:mm')}`;
  if (isTomorrow(d)) return `Tomorrow ${format(d, 'HH:mm')}`;
  return format(d, 'EEE d MMM, HH:mm');
}

export function fmtDate(iso: string): string {
  return format(new Date(iso), 'd MMM yyyy');
}

export function fmtDue(iso: string | null): { label: string; tone: 'danger' | 'warning' | 'info' } {
  if (!iso) return { label: 'No due date', tone: 'info' };
  const d = new Date(iso);
  if (isPast(d)) return { label: 'Overdue', tone: 'danger' };
  if (isToday(d)) return { label: 'Due today', tone: 'danger' };
  if (isTomorrow(d)) return { label: 'Due tomorrow', tone: 'warning' };
  return { label: `Due ${format(d, 'EEE d MMM')}`, tone: 'info' };
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Shabbos'];
