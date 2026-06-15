import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { MemberService } from '../../services/member.service';
import { RbacService } from '../../services/rbac.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import type { Role, StoreMemberWithDetails } from '../../types';

const STATUS_BADGES: Record<string, string> = {
  active: 'badge-success',
  invited: 'badge-warning',
  suspended: 'badge-danger',
};

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
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Staff</h1>
          <p className="page-subtitle">
            {members.length} team member{members.length === 1 ? '' : 's'}
          </p>
        </div>
        {canInvite && (
          <Button className="btn-sm" onClick={() => setShowInvite((v) => !v)}>
            {showInvite ? 'Cancel' : 'Invite staff'}
          </Button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {showInvite && canInvite && (
        <form className="card" onSubmit={handleInvite}>
          <FormField
            id="invite-email"
            label="Email"
            type="email"
            value={inviteEmail}
            onChange={setInviteEmail}
            placeholder="staff@example.com"
            required
          />
          <div className="form-group">
            <label className="form-label" htmlFor="invite-role">
              Role
            </label>
            <select id="invite-role" className="select-input" value={inviteRoleId} onChange={(e) => setInviteRoleId(e.target.value)}>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
          <p className="form-hint">They'll see this store as soon as they sign up or log in with this email address.</p>
          <div className="btn-row">
            <Button type="submit" loading={saving} className="btn-sm">
              Send invite
            </Button>
          </div>
        </form>
      )}

      {members.length === 0 ? (
        <div className="empty-state">No staff members yet.</div>
      ) : (
        <div className="list">
          {members.map((member) => {
            const isSelf = member.userId === user?.id;
            const isOwnerRow = member.roleName === 'owner';
            const canEditRow = !isSelf && !isOwnerRow;

            return (
              <div key={member.id} className="list-item">
                <div>
                  <p className="list-item-title">{member.name || member.invitedEmail}</p>
                  <p className="list-item-subtitle">
                    {member.status === 'invited' ? `Invited · ${member.invitedEmail}` : member.email}
                  </p>
                </div>
                <div className="list-item-meta">
                  <span className={`badge ${STATUS_BADGES[member.status] ?? 'badge-default'}`} style={{ textTransform: 'capitalize' }}>
                    {member.status}
                  </span>
                  {canManage && canEditRow && member.status === 'active' ? (
                    <select
                      className="select-input"
                      style={{ width: 'auto' }}
                      value={member.roleId}
                      onChange={(e) => handleRoleChange(member.id, e.target.value)}
                    >
                      {roles.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name.replace('_', ' ')}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="badge badge-default" style={{ textTransform: 'capitalize' }}>
                      {(member.roleName ?? '').replace('_', ' ')}
                    </span>
                  )}
                  {canRemove && (canEditRow || member.status === 'invited') && (
                    <Button variant="ghost" className="btn-sm" onClick={() => handleRemove(member)}>
                      {member.status === 'invited' ? 'Cancel' : 'Remove'}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
