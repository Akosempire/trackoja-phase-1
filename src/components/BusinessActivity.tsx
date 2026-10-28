import { formatMoney } from '../utils/format';
import { Link } from 'react-router-dom';
import type { AuditLog } from '../types';
import { activityRoute, activityTitle } from '../utils/business-activity';
import { StateBlock } from './ui/StateBlock';

export function BusinessActivity({ logs, actorId, actorName }: { logs: AuditLog[]; actorId?: string; actorName?: string }) {
  if (!logs.length) return <StateBlock compact title="No business activity yet" body="Sales, stock changes and customer updates will appear here." />;
  return <ul className="business-activity m-0 list-none divide-y divide-line p-0">{logs.map(log => {
    const route = activityRoute(log);
    const details = log.details && typeof log.details === 'object' && !Array.isArray(log.details) ? log.details : {};
    const amount = log.resourceType === 'sale' ? details.total : log.resourceType.includes('payment') ? details.amount : undefined;
    const who = log.actorId === actorId && actorName ? actorName : 'Team member';
    const when = new Date(log.createdAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return <li className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0" key={log.id}>
      <div className="min-w-0">
        <p className="m-0 truncate text-sm font-medium text-ink">{route ? <Link className="text-ink no-underline hover:underline" to={route}>{activityTitle(log)}</Link> : activityTitle(log)}</p>
        <p className="m-0 mt-0.5 truncate text-xs text-ink-3">{log.resourceName ? `${log.resourceName} · ` : ''}{who} · <time dateTime={log.createdAt}>{when}</time>{log.status !== 'success' ? ` · ${log.status}` : ''}</p>
      </div>
      {typeof amount === 'number' && Number.isFinite(amount) && <span className="shrink-0 text-sm font-semibold tabular-nums text-ink">{formatMoney(amount)}</span>}
    </li>;
  })}</ul>;
}
