// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import IntegrationsArea from '../src/pages/platform/areas/IntegrationsArea';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock('../src/components/platform/PlatformContext', () => ({
  usePlatform: () => ({ environment: { label: 'Production' }, can: () => true }),
}));
vi.mock('../src/config/supabase', () => ({
  supabase: { rpc: mocks.rpc },
}));

let root: Root | null = null;
let host: HTMLDivElement | null = null;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

async function renderScreen() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(createElement(IntegrationsArea)));
  return host;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.clearAllMocks();
});

describe('platform integrations screen', () => {
  it('shows real merchant diagnostics and concise service setup without the obsolete read-only specification', async () => {
    mocks.rpc.mockResolvedValue({ data: { liveConnections: 2, liveTransactionsToday: 3 }, error: null });
    const screen = await renderScreen();

    expect(mocks.rpc).toHaveBeenCalledWith('platform_moniepoint_health');
    const terms = Array.from(screen.querySelectorAll('dt'));
    expect(terms.find((term) => term.textContent === 'Live merchant connections')?.nextElementSibling?.textContent).toBe('2');
    expect(screen.querySelectorAll('section[aria-labelledby="integrations-services"] tbody tr')).toHaveLength(3);
    expect(screen.textContent).toContain('No webhook delivery history');
    expect(screen.textContent).not.toContain('The write path does not exist');
    expect(screen.textContent).not.toContain('CREATE TABLE');
  });

  it('offers retry when merchant diagnostics fail, without displaying zero counts', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Diagnostics unavailable' } });
    const screen = await renderScreen();

    expect(screen.textContent).toContain('Diagnostics unavailable');
    expect(screen.querySelector('dt')).toBeNull();

    mocks.rpc.mockResolvedValueOnce({ data: { liveConnections: 4 }, error: null });
    const retry = Array.from(screen.querySelectorAll('button')).find((button) => button.textContent?.includes('Try again'));
    expect(retry).toBeDefined();
    await act(async () => retry?.click());

    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(screen.querySelector('dt')?.nextElementSibling?.textContent).toBe('4');
  });
});
