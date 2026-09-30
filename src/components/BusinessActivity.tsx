import { formatMoney } from '../utils/format';
import { Link } from 'react-router-dom';
import type { AuditLog } from '../types';
import { activityRoute, activityTitle } from '../utils/business-activity';
import { StateBlock } from './ui/StateBlock';
export function BusinessActivity({ logs, actorId, actorName }: { logs: AuditLog[]; actorId?: string; actorName?: string }) {
  if (!logs.length) return <StateBlock compact title="No business activity yet" body="Sales, stock changes and customer updates will appear here." />;
  return <div className="list business-activity">{logs.map(log => {
    const route = activityRoute(log);
    const details = log.details && typeof log.details === 'object' && !Array.isArray(log.details) ? log.details : {};
    const amount = log.resourceType === 'sale' ? details.total : log.resourceType.includes('payment') ? details.amount : undefined;
    return <div className="list-item" key={log.id}><div>
      <p className="list-item-title">{route ? <Link to={route}>{activityTitle(log)}</Link> : activityTitle(log)}</p>
      {typeof amount === 'number' && Number.isFinite(amount) && <p className="list-item-subtitle">{formatMoney(amount)}</p>}
      {log.resourceName && <p className="list-item-subtitle">{log.resourceName}</p>}
      <p className="list-item-subtitle">{log.actorId === actorId && actorName ? actorName : 'Team member'} · <time dateTime={log.createdAt}>{new Date(log.createdAt).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>{log.status !== 'success' ? ` · ${log.status}` : ''}</p>
    </div></div>;
  })}</div>;
}
