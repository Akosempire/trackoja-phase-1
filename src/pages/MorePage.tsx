import '../styles/owner-dashboard.css';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppNav } from '../hooks/useAppNav';
import { AuthService } from '../services/auth.service';
import { InstallAppAction } from '../components/InstallAppAction';
import { ThemeSelect } from '../components/ThemeSelect';
import { useToast } from '../components/ui/Toast';
import { ChevronRightIcon, DownloadIcon, LogoutIcon } from '../components/icons';

export default function MorePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { allItems } = useAppNav();
  const [busy, setBusy] = useState(false);
  async function logout() {
    if (busy) return;
    setBusy(true);
    try { await AuthService.logout(); navigate('/login', { replace: true }); }
    catch { toast.error('Could not log out. Please try again.'); }
    finally { setBusy(false); }
  }
  return <div className="page more-page">
    <div className="page-header"><h1 className="page-title">More</h1></div>
    <div className="more-groups">
      {['Business operations', 'Management', 'Payments and connections', 'Account'].map(group => {
        const links = allItems.filter(item => item.group === group && !['/dashboard', '/more'].includes(item.to));
        if (!links.length && group !== 'Account') return null;
        return <section className="card" key={group} aria-label={group}>
          <h2>{group}</h2><div className="list">
            {links.map(item => <Link key={item.to} to={item.to} className="list-item">
              <span className="list-item-leading"><item.icon width={20} height={20} /><span>{item.label}</span></span>
              <ChevronRightIcon width={18} height={18} />
            </Link>)}
            {group === 'Account' && <>
              <div className="list-item"><span>Appearance</span><ThemeSelect /></div>
              <InstallAppAction onlyWhenAvailable className="list-item" label="Install TrackOja" icon={<DownloadIcon width={20} height={20} />} />
              <button type="button" className="list-item" disabled={busy} onClick={() => void logout()}>
                <span className="list-item-leading"><LogoutIcon width={20} height={20} />{busy ? 'Logging out...' : 'Log out'}</span>
              </button>
            </>}
          </div>
        </section>;
      })}
    </div>
  </div>;
}
