// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider, Link } from 'react-router-dom';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';
import { ProtectedRoute, AuthEntryRedirect, GuestRoute } from '../src/routes/ProtectedRoute';
import { useWorkspaceState } from '../src/hooks/useWorkspaceState';
import { safeReturnPath, rememberRoute, restoredRoute, clearRestoration } from '../src/utils/session-continuity';
const mock = vi.hoisted(() => ({ listener: null as any, session: vi.fn(), profile: vi.fn(), entry: vi.fn() }));
vi.mock('../src/services/auth.service', () => ({ AuthService: { getSession: mock.session, getUserProfile: mock.profile, onAuthStateChange: (callback: any) => { mock.listener = callback; return { data: { subscription: { unsubscribe() {} } } }; } } }));
vi.mock('../src/services/member.service', () => ({ MemberService: { acceptPendingInvitations: async () => [] } }));
vi.mock('../src/services/entry.service', () => ({ EntryService: { resolve: mock.entry } }));
const entry = { kind: 'existing_user', destination: '/dashboard', hasAccess: true, currentOrgId: 'org', currentStoreId: 'branch', merchantDestination: '/dashboard' } as any;
let root: Root; let host: HTMLDivElement;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
beforeEach(() => {
  // Node's Request rejects jsdom's AbortSignal; these routes have no loaders.
  const NativeRequest = globalThis.Request;
  vi.stubGlobal('Request', class extends NativeRequest { constructor(input: RequestInfo | URL, init?: RequestInit) { super(input, { ...init, signal: undefined }); } });
  sessionStorage.clear(); localStorage.clear();
  mock.session.mockReset().mockResolvedValue({ user: { id: 'one' } });
  mock.profile.mockReset().mockResolvedValue({ id: 'one', currentOrgId: 'org', currentStoreId: 'branch' });
  mock.entry.mockReset().mockResolvedValue(entry);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function Page() {
  const { refreshProfile, profile } = useAuth();
  const [draft, setDraft] = useWorkspaceState('quantity', '');
  return <><p>{profile?.currentStoreId}</p><input aria-label="Quantity" value={draft} onChange={event => setDraft(event.target.value)} /><button onClick={() => setDraft('12')}>Draft</button><button onClick={() => void refreshProfile()}>Revalidate</button><Link to="/inventory/products">Products</Link><Link to="/inventory/stock">Stock</Link></>;
}
async function mount(path = '/dashboard') {
  const router = createMemoryRouter([{ element: <ProtectedRoute />, children: ['/dashboard','/inventory/products','/inventory/stock'].map(path => ({ path, element: <Page /> })) }, { path: '/auth/continue', element: <AuthEntryRedirect /> }, { element: <GuestRoute />, children: [{ path: '/login', element: <p>Sign in</p> }] }], { initialEntries: [path] });
  await act(async () => root.render(<AuthProvider><RouterProvider router={router} /></AuthProvider>));
  return router;
}
it('keeps three-page history, branch and draft through focus, token refresh and network loss', async () => {
  const router = await mount();
  await act(async () => { await router.navigate('/inventory/products'); });
  await act(async () => { await router.navigate('/inventory/stock'); });
  await act(async () => (Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Draft')!).click());
  const input = host.querySelector('input');
  mock.session.mockRejectedValue(new Error('Offline'));
  await act(async () => { window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange')); mock.listener({ id: 'one' }, 'SIGNED_IN'); mock.listener({ id: 'one' }, 'TOKEN_REFRESHED'); mock.listener(null, 'TOKEN_REFRESHED'); });
  expect(host.querySelector('input')).toBe(input); expect(input?.value).toBe('12');
  expect(host.textContent).toContain('branch'); expect(router.state.location.pathname).toBe('/inventory/stock');
  expect(mock.entry).toHaveBeenCalledTimes(1);
  await act(async () => { await router.navigate(-1); }); expect(router.state.location.pathname).toBe('/inventory/products');
  await act(async () => { await router.navigate(-1); }); expect(router.state.location.pathname).toBe('/dashboard');
});
it('failed cold session stays at the direct link with a working retry', async () => {
  mock.session.mockRejectedValueOnce(new Error('Offline'));
  const router = await mount('/inventory/stock');
  expect(router.state.location.pathname).toBe('/inventory/stock'); expect(host.textContent).toContain('Try again');
  await act(async () => host.querySelector('button')!.click());
  expect(host.querySelector('input')).not.toBeNull(); expect(router.state.location.pathname).toBe('/inventory/stock');
});
it('failed background resolution keeps the current input mounted', async () => {
  await mount('/inventory/stock'); const input = host.querySelector('input');
  mock.entry.mockRejectedValueOnce(new Error('Network unavailable'));
  await act(async () => (Array.from(host.querySelectorAll('button')).find(button => button.textContent === 'Revalidate')!).click());
  expect(host.querySelector('input')).toBe(input); expect(host.textContent).toContain('Connection interrupted');
});
it('restores a same-user, same-branch route on a PWA entry launch', async () => {
  rememberRoute('one', 'org', 'branch', '/inventory/stock?status=active');
  const router = await mount('/auth/continue'); expect(router.state.location.pathname).toBe('/inventory/stock');
});
it('confirmed logout clears recovery data and retains a safe sign-in destination', async () => {
  const router = await mount('/inventory/stock');
  await act(async () => mock.listener(null, 'SIGNED_OUT'));
  expect(router.state.location.pathname).toBe('/login'); expect(router.state.location.search).toContain('next=');
  expect(Object.keys(sessionStorage).filter(key => key.startsWith('trackoja:resume:'))).toEqual([]);
});
it('bounds initialization and offers retry rather than an infinite loader', async () => {
  vi.useFakeTimers(); mock.session.mockImplementation(() => new Promise(() => {}));
  await mount('/inventory/stock'); expect(host.textContent).toContain('Opening your workspace');
  await act(async () => vi.advanceTimersByTimeAsync(15001)); expect(host.textContent).toContain('Try again');
});
it('rejects unsafe URLs and cross-user or cross-branch restore records', () => {
  for (const path of ['https://evil.test','//evil.test','/\\evil.test','/auth/callback','/login','/welcome','/inventory%2fproducts','/inventory/missing']) expect(safeReturnPath(path)).toBeNull();
  rememberRoute('one', 'org', 'branch', '/reports?period=month&access_token=secret');
  expect(restoredRoute('one', entry)).toBe('/reports?period=month');
  expect(restoredRoute('two', entry)).toBeNull(); expect(restoredRoute('one', { ...entry, currentStoreId: 'another' })).toBeNull();
  expect(restoredRoute('one', { ...entry, hasAccess: false, destination: '/onboarding' })).toBeNull();
  clearRestoration(); expect(restoredRoute('one', entry)).toBeNull();
});
