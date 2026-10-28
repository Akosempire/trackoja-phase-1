import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppNav } from '../hooks/useAppNav';
import { AuthService } from '../services/auth.service';
import { InstallAppAction } from '../components/InstallAppAction';
import { ThemeSelect } from '../components/ThemeSelect';
import { useToast } from '../components/ui/Toast';
import { ChevronRightIcon, DownloadIcon, LogoutIcon } from '../components/icons';
import { Page, PageHeader } from '../components/kit';

const GROUPS = ['Business operations', 'Management', 'Payments and connections', 'Account'];

const row = 'flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-ink no-underline transition-colors hover:bg-subtle sm:px-5';
const iconBox = 'inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-tray text-ink-2';

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
  return (
    <Page width="form">
      <PageHeader title="More" subtitle="Everything else in your shop" />
      <div className="flex flex-col gap-6">
        {GROUPS.map(group => {
          const links = allItems.filter(item => item.group === group && !['/dashboard', '/more'].includes(item.to));
          if (!links.length && group !== 'Account') return null;
          const headingId = `more-${group.toLowerCase().replace(/\W+/g, '-')}`;
          return (
            <section key={group} aria-labelledby={headingId}>
              <h2 id={headingId} className="m-0 mb-2 px-1 text-[13px] font-semibold text-ink-2">{group}</h2>
              <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                <ul className="m-0 list-none divide-y divide-line p-0">
                  {links.map(item => (
                    <li key={item.to}>
                      <Link to={item.to} className={row}>
                        <span className={iconBox}><item.icon width={18} height={18} /></span>
                        <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                        <span className="shrink-0 text-ink-3"><ChevronRightIcon width={16} height={16} /></span>
                      </Link>
                    </li>
                  ))}
                  {group === 'Account' && <>
                    <li className="flex min-h-[52px] items-center px-4 py-2 sm:px-5 [&_.tl-theme]:w-full [&_.tl-theme]:text-sm [&_.tl-theme]:font-medium [&_.tl-theme]:text-ink [&_select]:h-9">
                      <ThemeSelect />
                    </li>
                    <li className="empty:hidden">
                      <InstallAppAction onlyWhenAvailable
                        className={`${row} border-0 bg-transparent font-medium [&_.install-app-action-main]:gap-3`}
                        label="Install TrackOja"
                        icon={<span className={iconBox}><DownloadIcon width={18} height={18} /></span>} />
                    </li>
                    <li>
                      <button type="button" className={`${row} border-0 bg-transparent font-medium text-danger disabled:opacity-60`} disabled={busy} onClick={() => void logout()}>
                        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-danger"><LogoutIcon width={18} height={18} /></span>
                        {busy ? 'Logging out...' : 'Log out'}
                      </button>
                    </li>
                  </>}
                </ul>
              </div>
            </section>
          );
        })}
      </div>
    </Page>
  );
}
