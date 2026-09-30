// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DashboardRevenuePanel, type DashboardRevenue } from '../src/components/ui/DashboardRevenuePanel';
import { getReportDateRange } from '../src/utils/report-date-ranges';
let root: Root; let host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
const sample: DashboardRevenue = { total: 22500, count: 3, rows: [{ key: 'cash', label: 'Cash', amount: 22500 }] };
async function mount(load: () => Promise<DashboardRevenue>) { await act(async () => root.render(createElement(DashboardRevenuePanel, { load, title: 'Sales revenue', breakdownTitle: 'Payment methods', note: 'Completed sales', emptyDescription: 'Record a sale to get started.' }))); }
const click = async (text: string) => { await act(async () => Array.from(host.querySelectorAll('button')).find(button => button.textContent === text)!.click()); };
it('loads each period using its real range and updates the displayed values', async () => {
  const load = vi.fn().mockResolvedValue(sample); await mount(load);
  for (const [label, preset] of [['Today', 'today'], ['Last 7 days', 'last7'], ['This month', 'thisMonth'], ['Last 30 days', 'last30']] as const) {
    await click(label); expect(load).toHaveBeenLastCalledWith(getReportDateRange(preset));
    expect(host.textContent).toContain('₦22,500'); expect(host.querySelector('[aria-checked="true"]')?.textContent).toBe(label);
  }
});
it('never flashes zero while loading and ignores an old period response', async () => {
  let finish!: (value: DashboardRevenue) => void;
  const load = vi.fn().mockImplementationOnce(() => new Promise<DashboardRevenue>(resolve => { finish = resolve; })).mockResolvedValue({ ...sample, total: 45000 });
  await mount(load); expect(host.textContent).not.toContain('₦0');
  await click('Today'); expect(host.textContent).toContain('₦45,000');
  await act(async () => finish(sample)); expect(host.querySelector('.dashboard-revenue-total strong')?.textContent).toBe('₦45,000');
});
it('keeps valid totals when a breakdown fails and offers retry', async () => {
  const load = vi.fn().mockResolvedValueOnce({ ...sample, rows: null }).mockResolvedValue(sample); await mount(load);
  expect(host.textContent).toContain('₦22,500'); expect(host.textContent).toContain('Breakdown unavailable');
  await click('Try again'); expect(host.textContent).toContain('Cash');
});
it('distinguishes a request error from an empty period and can recover', async () => {
  const load = vi.fn().mockRejectedValueOnce(new Error('Failed')).mockResolvedValue({ total: 0, count: 0, rows: [] }); await mount(load);
  expect(host.textContent).toContain('Revenue unavailable'); expect(host.textContent).not.toContain('₦0');
  await click('Try again'); expect(host.textContent).toContain('No revenue in this period'); expect(host.textContent).toContain('₦0');
});
