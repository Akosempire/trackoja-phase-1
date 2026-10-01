import { createRoot } from 'react-dom/client';
import { HashRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from '../../src/contexts/AuthContext';
import { AuthService } from '../../src/services/auth.service';
import { EntryService } from '../../src/services/entry.service';
import { MemberService } from '../../src/services/member.service';
import { ProtectedRoute, GuestRoute, AuthEntryRedirect } from '../../src/routes/ProtectedRoute';
import { useWorkspaceState } from '../../src/hooks/useWorkspaceState';
import '../../src/styles/theme.css';
import '../../src/styles/tokens.css';
import '../../src/styles/waya.css';
let listener: (user: any, event: any) => void;
let signedIn = true;
let branch = sessionStorage.getItem('fixture-branch') ?? 'first';
const params = new URLSearchParams(location.search);
let offline = params.has('offline');
AuthService.getSession = async () => { if (offline) throw new Error('Offline'); return signedIn ? { user: { id: 'fixture-user' } } as any : null; };
AuthService.getUserProfile = async () => ({ id: 'fixture-user', currentOrgId: 'fixture-org', currentStoreId: branch }) as any;
AuthService.onAuthStateChange = callback => { listener = callback; return { data: { subscription: { unsubscribe() {} } } } as any; };
MemberService.acceptPendingInvitations = async () => [] as any;
EntryService.resolve = async () => { if (offline) throw new Error('Offline'); return { kind: 'existing_user', destination: '/dashboard', hasAccess: true, currentOrgId: 'fixture-org', currentStoreId: branch } as any; };
(window as any).resumeTest = { event: (event: string) => listener({ id: 'fixture-user' }, event), offline: (value: boolean) => { offline = value; }, logout: () => { signedIn = false; listener(null, 'SIGNED_OUT'); } };
function Screen() {
  const { profile, refreshProfile } = useAuth();
  const path = useLocation().pathname;
  const [quantity, setQuantity] = useWorkspaceState('stock-quantity', '');
  const [filter, setFilter] = useWorkspaceState('stock-filter', 'all');
  return <main><h1>{path}</h1><Link to="/dashboard">Overview</Link> <Link to="/inventory/products">Products</Link> <Link to="/inventory/stock">Stock</Link>
    <label>Branch<select aria-label="Branch" value={profile?.currentStoreId} onChange={event => { branch = event.target.value; sessionStorage.setItem('fixture-branch', branch); void refreshProfile(); }}><option value="first">First branch</option><option value="second">Second branch</option></select></label>
    <label>Filter<select aria-label="Filter" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All</option><option value="low">Low stock</option></select></label>
    <label>Quantity<input value={quantity} onChange={event => setQuantity(event.target.value)} /></label>
  </main>;
}
createRoot(document.getElementById('root')!).render(<HashRouter><AuthProvider><Routes><Route element={<ProtectedRoute />}>{['/dashboard','/inventory/products','/inventory/stock'].map(path => <Route key={path} path={path} element={<Screen />} />)}</Route><Route path="/auth/continue" element={<AuthEntryRedirect />} /><Route element={<GuestRoute />}><Route path="/login" element={<h1>Sign in</h1>} /></Route></Routes></AuthProvider></HashRouter>);
