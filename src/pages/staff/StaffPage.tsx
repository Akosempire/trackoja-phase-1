import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { MemberService } from '../../services/member.service';
import { RbacService } from '../../services/rbac.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import { StateBlock } from '../../components/ui/StateBlock';
import { Avatar, Card, CardHead, Page, PageHeader, Pill, cn, inputClass } from '../../components/kit';
import type { Role, StoreMemberWithDetails } from '../../types';

const STATUS_TONES: Record<string, 'success' | 'warn' | 'danger' | 'neutral'> = {
  active: 'success',
  invited: 'warn',
  suspended: 'danger',
};

const roleLabel = (name?: string) => (name ?? '').replace('_', ' ');

export default function StaffPage() {
  const { user, profile } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const storeId = profile?.currentStoreId;

  const [members, setMembers] = useState<StoreMemberWithDetails[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoleId, setInviteRoleId] = useState('');

  const canInvite = hasPermission('member:invite');
  const canManage = hasPermission('member:manage');
  const canRemove = hasPermission('member:remove');

  const load = () => {
    if (!storeId) return;
    setLoading(true);
    Promise.all([MemberService.getStoreMembersDetailed(storeId), RbacService.getSystemRoles()])
      .then(([m, r]) => {
        setMembers(m);
        const invitable = r.filter((role) => role.name !== 'owner');
        setRoles(invitable);
        setInviteRoleId((current) => current || invitable.find((role) => role.name === 'cashier')?.id || invitable[0]?.id || '');
      })
      .catch((err) => setError(err.message ?? 'Failed to load staff'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [storeId]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId || !user || !inviteRoleId) return;

    setSaving(true);
    setError(null);
    try {
      await MemberService.inviteStaff(storeId, user.id, {
        email: inviteEmail.trim().toLowerCase(),
        roleId: inviteRoleId,
      });
      setInviteEmail('');
      setShowInvite(false);
      load();
    } catch (err: any) {
      setError(err.message ?? 'Failed to invite staff member');
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (memberId: string, roleId: string) => {
    if (!storeId) return;
    setError(null);
    try {
      await MemberService.updateMemberRole(storeId, memberId, roleId);
      load();
    } catch (err: any) {
      setError(err.message ?? 'Failed to update role');
    }
  };

  const handleRemove = async (member: StoreMemberWithDetails) => {
    if (!storeId) return;
    const label = member.name || member.invitedEmail || 'this member';
    const verb = member.status === 'invited' ? 'Cancel the invitation for' : 'Remove';
    if (!confirm(`${verb} ${label}?`)) return;

    setError(null);
    try {
      await MemberService.removeMember(storeId, member.id);
      load();
    } catch (err: any) {
      setError(err.message ?? 'Failed to remove member');
    }
  };

  if (loading || permsLoading) return <PageLoader />;

  return (
    <Page>
      <PageHeader
        title="Staff"
        subtitle={`${members.length} team member${members.length === 1 ? '' : 's'}`}
        actions={canInvite && (
          <Button variant={showInvite ? 'outline' : 'primary'} onClick={() => setShowInvite((v) => !v)}>
            {showInvite ? 'Cancel' : 'Invite staff'}
          </Button>
        )}
      />

      {error && <div className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</div>}

      {showInvite && canInvite && (
        <Card className="mb-4 lg:mb-6">
          <form onSubmit={handleInvite} aria-labelledby="invite-title">
            <CardHead title={<span id="invite-title">Invite a team member</span>}
              hint="They'll see this store as soon as they sign up or log in with this email address." />
            <div className="grid gap-x-4 sm:grid-cols-[minmax(0,1fr)_200px]">
              <FormField
                id="invite-email"
                label="Email"
                type="email"
                value={inviteEmail}
                onChange={setInviteEmail}
                placeholder="staff@example.com"
                required
              />
              <div className="mb-4 flex min-w-0 flex-col gap-1.5">
                <label className="text-[13px] font-medium text-ink-2" htmlFor="invite-role">
                  Role
                </label>
                <select id="invite-role" className={cn(inputClass, 'capitalize')} value={inviteRoleId} onChange={(e) => setInviteRoleId(e.target.value)}>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {roleLabel(r.name)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end">
              <Button type="submit" loading={saving} className="w-full sm:w-auto">
                Send invite
              </Button>
            </div>
          </form>
        </Card>
      )}

      {members.length === 0 ? (
        <Card>
          <StateBlock
            title="No staff members yet"
            body="Invite a team member and assign the access they need."
          />
        </Card>
      ) : (
        <Card padded={false} className="overflow-hidden">
          <ul className="m-0 list-none divide-y divide-line p-0" aria-label="Team members">
            {members.map((member) => {
              const isSelf = member.userId === user?.id;
              const isOwnerRow = member.roleName === 'owner';
              const canEditRow = !isSelf && !isOwnerRow;
              const display = member.name || member.invitedEmail || '';

              return (
                <li key={member.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Avatar name={display} className={cn('rounded-full', member.status !== 'active' && 'bg-tray text-ink-2')} />
                    <div className="min-w-0">
                      <p className="m-0 truncate text-sm font-medium text-ink">
                        {display}
                        {isSelf && <span className="font-normal text-ink-3"> (you)</span>}
                      </p>
                      <p className="m-0 mt-0.5 truncate text-xs text-ink-3">
                        {member.status === 'invited' ? `Invited · ${member.invitedEmail}` : member.email}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 pl-[52px] sm:shrink-0 sm:pl-0">
                    {member.status !== 'active' && <Pill tone={STATUS_TONES[member.status] ?? 'neutral'}><span className="capitalize">{member.status}</span></Pill>}
                    {canManage && canEditRow && member.status === 'active' ? (
                      <select
                        className="h-9 rounded-md border border-line-strong bg-surface px-2.5 text-[13px] capitalize text-ink focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15"
                        aria-label={`Role for ${display}`}
                        value={member.roleId}
                        onChange={(e) => handleRoleChange(member.id, e.target.value)}
                      >
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {roleLabel(r.name)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Pill tone={isOwnerRow ? 'brand' : 'neutral'}><span className="capitalize">{roleLabel(member.roleName)}</span></Pill>
                    )}
                    {canRemove && (canEditRow || member.status === 'invited') && (
                      <Button variant="ghost" className="btn-sm" onClick={() => handleRemove(member)}>
                        {member.status === 'invited' ? 'Cancel' : 'Remove'}
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </Page>
  );
}
