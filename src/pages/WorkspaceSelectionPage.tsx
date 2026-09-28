import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { PageLoader } from '../components/ui/PageLoader';
import { StateBlock } from '../components/ui/StateBlock';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../contexts/AuthContext';
import { EntryService, type WorkspaceChoice } from '../services/entry.service';

export default function WorkspaceSelectionPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { refreshProfile } = useAuth();
  const [workspaces, setWorkspaces] = useState<WorkspaceChoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);
  useEffect(() => {
    EntryService.listWorkspaces().then(setWorkspaces)
      .catch((cause) => setError(cause instanceof Error ? cause.message : 'Businesses could not be loaded.'))
      .finally(() => setLoading(false));
  }, []);
  if (loading) return <PageLoader />;

  async function select(workspace: WorkspaceChoice) {
    setSelecting(workspace.orgId);
    const toastId = toast.loading('Opening your business…');
    try {
      const result = await EntryService.selectWorkspace(workspace.orgId);
      await refreshProfile();
      toast.dismiss(toastId);
      // Choosing a workspace is an explicit request to enter the customer app.
      // Platform admins keep `/platform` as their default sign-in destination,
      // so use the separately enforced merchant destination here.
      navigate(result.merchantDestination ?? result.destination, { replace: true });
    } catch (cause) {
      toast.update(toastId, { variant: 'error', message: 'Could not open business',
        description: cause instanceof Error ? cause.message : 'Try again.' });
      setSelecting(null);
    }
  }

  return <main className="onboarding-shell workspace-selection">
    <div className="onboarding-header"><span className="eyebrow">TrackOja</span>
      <h1 className="onboarding-title">Choose a business</h1>
      <p className="onboarding-subtitle">You belong to more than one workspace. Choose where you want to continue.</p>
    </div>
    {error ? <StateBlock variant="error" title="Businesses unavailable" body={error} /> :
      <div className="onboarding-plan-grid">{workspaces.map((workspace) =>
        <article className="card onboarding-plan-card" key={workspace.orgId}>
          <div><h2>{workspace.orgName}</h2><p>{workspace.storeName ?? 'No active store'} · {workspace.role}</p></div>
          <Button onClick={() => void select(workspace)} loading={selecting === workspace.orgId}>Open business</Button>
        </article>)}</div>}
  </main>;
}
