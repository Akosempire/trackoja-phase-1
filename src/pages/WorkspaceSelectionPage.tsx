import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { PageLoader } from '../components/ui/PageLoader';
import { StateBlock } from '../components/ui/StateBlock';
import { useToast } from '../components/ui/Toast';
import { useAuth } from '../contexts/AuthContext';
import { EntryService, type WorkspaceChoice } from '../services/entry.service';
import { Avatar, Card } from '../components/kit';

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

  return (
    <main className="min-h-dvh bg-canvas px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-[560px]">
        <div className="mb-6 text-center sm:mb-8">
          <p className="m-0 mb-1 text-[13px] font-semibold text-brand">TrackOja</p>
          <h1 className="m-0 text-2xl font-semibold leading-8 tracking-tight text-ink lg:text-[28px] lg:leading-9">Choose a business</h1>
          <p className="m-0 mt-1 text-sm text-ink-2">You belong to more than one workspace. Choose where you want to continue.</p>
        </div>
        {error ? (
          <Card><StateBlock variant="error" title="Businesses unavailable" body={error} /></Card>
        ) : (
          <Card padded={false} className="overflow-hidden">
            <ul className="m-0 list-none divide-y divide-line p-0">
              {workspaces.map((workspace) => (
                <li key={workspace.orgId} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                  <Avatar name={workspace.orgName} />
                  <div className="min-w-0 flex-1">
                    <h2 className="m-0 truncate text-[15px] font-semibold text-ink">{workspace.orgName}</h2>
                    <p className="m-0 mt-0.5 truncate text-[13px] text-ink-3">{workspace.storeName ?? 'No active store'} · <span className="capitalize">{workspace.role.replace(/_/g, ' ')}</span></p>
                  </div>
                  <Button variant="outline" className="btn-sm shrink-0" onClick={() => void select(workspace)} loading={selecting === workspace.orgId}>Open business</Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </main>
  );
}
