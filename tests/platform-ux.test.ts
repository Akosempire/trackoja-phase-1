// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import SupportArea from '../src/pages/platform/areas/SupportArea';
const state = vi.hoisted(() => ({ allowed: true, list: vi.fn(), notes: vi.fn() }));
vi.mock('../src/components/platform/PlatformContext', () => ({ usePlatform: () => ({ can: () => state.allowed }) }));
vi.mock('../src/services/platformAdmin.service', () => ({ PlatformAdminService: { listBusinesses: state.list, listSupportNotes: state.notes } }));
vi.mock('../src/components/ui/Toast', () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock('../src/components/icons', () => Object.fromEntries(['LockIcon', 'SearchIcon', 'CloseIcon', 'CheckIcon', 'AlertIcon', 'InfoIcon', 'BuildingIcon', 'CodeIcon', 'HomeIcon', 'KeyIcon', 'PlugIcon', 'PulseIcon', 'SettingsIcon', 'ShieldIcon', 'SubscriptionIcon', 'TicketIcon'].map((name) => [name, () => null])));
let root: Root; let host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => { state.allowed = true; state.list.mockReset().mockResolvedValue([]); state.notes.mockReset().mockResolvedValue([]); host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function mount() { await act(async () => root.render(createElement(MemoryRouter, {}, createElement(SupportArea)))); }
it('denies support without requesting business data', async () => { state.allowed = false; await mount(); expect(host.textContent).toContain('You do not have access'); expect(state.list).not.toHaveBeenCalled(); });
it('keeps real notes central and removes unimplemented ticket specifications', async () => { await mount(); expect(host.textContent).toContain('Support notes'); expect(host.textContent).not.toContain('CREATE TABLE'); expect(host.textContent).not.toContain('Frequent issues and urgent backlog'); expect(host.textContent).toContain('No businesses returned'); });
it('offers recovery when the directory fails', async () => { state.list.mockRejectedValueOnce(new Error('Connection interrupted')); await mount(); expect(host.textContent).toContain('Connection interrupted'); const retry = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Try again'))!; await act(async () => retry.click()); expect(state.list).toHaveBeenCalledTimes(2); expect(host.textContent).toContain('No businesses returned'); });
