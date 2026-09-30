import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useBusinessContext } from '../contexts/BusinessContext';
import { AuditService } from '../services/audit.service';
import { BusinessActivity } from '../components/BusinessActivity';
import { activityTypes, businessActivity } from '../utils/business-activity';
import { PageLoader } from '../components/ui/PageLoader';
import { StateBlock } from '../components/ui/StateBlock';
import { Button } from '../components/ui/Button';
import type { AuditLog } from '../types';
export default function BusinessActivityPage() {
  const { profile } = useAuth();
  const { hasPermission, loading } = usePermissions();
  const { modules } = useBusinessContext();
  const types = activityTypes(permission => hasPermission(permission) && (modules ?? []).includes(permission.startsWith('sales') ? 'sales' : permission.startsWith('inventory') ? 'inventory' : permission.startsWith('customer') ? 'customers' : 'tailoring')).join(',');
  const [result, setResult] = useState<{ key: string; logs: AuditLog[] | null } | null>(null);
  const [revision, setRevision] = useState(0);
  const key = `${profile?.currentStoreId}:${types}:${revision}`;
  useEffect(() => {
    let active = true;
    if (loading || !profile?.currentStoreId) return;
    AuditService.getStoreAuditLogs(profile.currentStoreId, 100, 0, types ? types.split(',') : [])
      .then(logs => { if (active) setResult({ key, logs: businessActivity(logs, types.split(',')) }); })
      .catch(() => { if (active) setResult({ key, logs: null }); });
    return () => { active = false; };
  }, [key, profile?.currentStoreId, types, loading]);
  return <div className="page business-activity-page"><div className="page-header"><div><h1 className="page-title">Business activity</h1><p className="page-subtitle">Latest 100 business events in the selected branch.</p></div></div>
    {loading || result?.key !== key ? <PageLoader /> : result.logs === null ? <StateBlock variant="error" title="Activity could not be loaded" actions={<Button onClick={() => setRevision(value => value + 1)}>Try again</Button>} /> : <div className="card"><BusinessActivity logs={result.logs} actorId={profile?.id} actorName={profile?.firstName} /></div>}
  </div>;
}
