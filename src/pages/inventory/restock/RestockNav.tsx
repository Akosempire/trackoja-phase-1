import { NavLink } from 'react-router-dom';
import { cn } from '../../../components/kit';
import { RESTOCK_TABS } from './shared';

/** Scrollable tabs for the restock screens. */
export function RestockNav() {
  return (
    <nav aria-label="Restock" className="-mx-4 mb-5 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <div className="inline-flex gap-1 rounded-lg bg-tray p-1">
        {RESTOCK_TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end className={({ isActive }) => cn('inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-md px-3 text-[13px] font-medium no-underline',
            isActive ? 'bg-surface text-ink shadow-card ring-1 ring-line' : 'text-ink-2 hover:text-ink')}>{t.label}</NavLink>
        ))}
      </div>
    </nav>
  );
}
