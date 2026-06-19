import { NavLink } from 'react-router-dom';
import { useAppNav } from '../hooks/useAppNav';
import { ScanIcon } from './icons';

export function BottomNav() {
  const { leftItems, rightItems, handleScan } = useAppNav();

  const renderLink = (item: ReturnType<typeof useAppNav>['leftItems'][number]) => (
    <NavLink
      key={item.to}
      to={item.to}
      end={item.end}
      className={({ isActive }) => `bottom-nav-link${isActive ? ' active' : ''}`}
    >
      <item.icon />
      <span>{item.label}</span>
    </NavLink>
  );

  return (
    <nav className="bottom-nav">
      {leftItems.map(renderLink)}
      <button type="button" className="bottom-nav-scan" onClick={handleScan} aria-label="Scan barcode">
        <ScanIcon width={26} height={26} />
        <span>Scan</span>
      </button>
      {rightItems.map(renderLink)}
    </nav>
  );
}
