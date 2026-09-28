import { useAuth } from '../contexts/AuthContext';
import { useAppNav } from '../hooks/useAppNav';
import { CommandSearch, type CommandSearchItem } from './CommandSearch';

export function MerchantCommandSearch() {
  const { profile } = useAuth();
  const { allItems } = useAppNav();
  const items: CommandSearchItem[] = allItems.map((item) => ({
    id: item.to.replace(/\W+/g, '-') || 'home',
    label: item.label,
    description: `Open ${item.label.toLocaleLowerCase()}`,
    group: 'Workspace',
    to: item.to,
  }));
  if (profile?.isPlatformAdmin) items.push({ id: 'platform', label: 'Platform', description: 'Open platform administration', group: 'Administration', to: '/platform' });
  return <CommandSearch items={items} label="Search" />;
}
