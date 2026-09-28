// utils/report-date-ranges.ts
// Date range presets for the Reports page (Phase 5)

export type ReportDateRangePreset = 'today' | 'last7' | 'last30' | 'thisMonth';

export interface ReportDateRange {
  from: string;
  to: string;
}

export const REPORT_DATE_RANGE_PRESETS: { value: ReportDateRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'thisMonth', label: 'This month' },
];

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Returns the [from, to) ISO timestamp range for a given preset, where `to`
 * is the start of the day after `now`.
 */
export function getReportDateRange(preset: ReportDateRangePreset, now: Date = new Date()): ReportDateRange {
  const todayStart = startOfDay(now);
  const tomorrowStart = addDays(todayStart, 1);

  switch (preset) {
    case 'today':
      return { from: todayStart.toISOString(), to: tomorrowStart.toISOString() };
    case 'last7':
      return { from: addDays(todayStart, -6).toISOString(), to: tomorrowStart.toISOString() };
    case 'last30':
      return { from: addDays(todayStart, -29).toISOString(), to: tomorrowStart.toISOString() };
    case 'thisMonth':
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(),
        to: tomorrowStart.toISOString(),
      };
  }
}

/** Formats the inclusive dates represented by a [from, to) report range. */
export function formatReportDateRange(range: ReportDateRange): string {
  const from = new Date(range.from);
  const through = new Date(new Date(range.to).getTime() - 1);
  if (Number.isNaN(from.getTime()) || Number.isNaN(through.getTime())) return 'Selected period';

  const sameDay = from.toDateString() === through.toDateString();
  const format = (date: Date, includeYear = true) =>
    date.toLocaleDateString('en-NG', {
      day: 'numeric',
      month: 'short',
      ...(includeYear ? { year: 'numeric' as const } : {}),
    });

  if (sameDay) return format(from);
  const sameYear = from.getFullYear() === through.getFullYear();
  return `${format(from, !sameYear)} – ${format(through)}`;
}
