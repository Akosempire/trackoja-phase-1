import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PlatformAdminService,
  PLATFORM_LEVELS,
  type PlatformAdminAccountV2,
  type PlatformUserRow,
} from '../../services/platformAdmin.service';
import { usePlatform } from './PlatformContext';
import { Badge } from '../ui/Badge';
import { StatusBadge } from '../ui/StatusBadge';
import { Button } from '../ui/Button';
import { DataTable, type DataTableColumn } from '../ui/DataTable';
import { ConfirmDialog, Dialog } from '../ui/Dialog';
import { FormField } from '../ui/FormField';
import { SectionHead } from '../ui/SectionHead';
import { SectionState } from '../ui/StateBlock';
import { useToast } from '../ui/Toast';
import { type DefRow } from '../ui/DefList';
import { tableBleed } from './ui';
import { APP_NAME } from '../../config/brand';
import { formatDateTime, formatRelative } from '../../utils/format';

/** Level values the server accepts, taken from the same list the screen explains. */
const LEVEL_VALUES = PLATFORM_LEVELS.map((entry) => entry.level) as readonly string[];

/**
 * Platform users and roles.
 *
 * Lives in the Businesses & Users area because that is the area named for users;
 * the ten-area structure does not gain an eleventh. It is rendered only for an
 * operator who holds `platform:manage_users`, and every action is re-authorised
 * server-side, which is what actually protects it.
 *
 * Note what the level means here: for every level except platform owner, the
 * account's abilities are exactly the permission keys granted to it. The level
 * decides which keys are seeded at appointment; the keys decide what is possible.
 */
export function PlatformRolesSection() {
  const { can } = usePlatform();
  const toast = useToast();

  const [accounts, setAccounts] = useState<PlatformAdminAccountV2[]>([]);
  const [candidates, setCandidates] = useState<PlatformUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [appointOpen, setAppointOpen] = useState(false);
  const [appointUser, setAppointUser] = useState('');
  const [appointLevel, setAppointLevel] = useState('admin');
  const [appointNote, setAppointNote] = useState('');
  const [appointBusy, setAppointBusy] = useState(false);
  const [appointError, setAppointError] = useState<string | null>(null);

  const [levelTarget, setLevelTarget] = useState<PlatformAdminAccountV2 | null>(null);
  const [levelValue, setLevelValue] = useState('admin');
  const [levelBusy, setLevelBusy] = useState(false);
  const [levelError, setLevelError] = useState<string | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<PlatformAdminAccountV2 | null>(null);

  const allowed = can('platform:manage_users');

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    setError(null);
    try {
      // Both reads need the same permission, so they can go together; either one
      // failing still leaves a usable screen, so they are settled separately.
      const [roster, users] = await Promise.allSettled([
        PlatformAdminService.listPlatformAdminAccountsV2(),
        PlatformAdminService.listUsers({ limit: 200 }),
      ]);

      if (roster.status === 'fulfilled') setAccounts(roster.value);
      if (users.status === 'fulfilled') setCandidates(users.value);

      if (roster.status === 'rejected') {
        setError(roster.reason instanceof Error ? roster.reason.message : 'The roster could not be loaded.');
      }
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    void load();
  }, [load]);

  /** People who could be appointed: real users who are not already active admins. */
  const appointable = useMemo(() => {
    const admins = new Set(accounts.filter((account) => account.status === 'active').map((account) => account.userId));
    return candidates.filter((candidate) => !admins.has(candidate.userId));
  }, [candidates, accounts]);

  if (!allowed) return null;

  function messageOf(cause: unknown, fallback: string): string {
    // PostgREST returns a plain object rather than an Error, so `instanceof`
    // would drop the server's own wording — which is the useful part.
    if (cause && typeof cause === 'object' && 'message' in cause) return String((cause as { message: unknown }).message);
    return fallback;
  }

  async function submitAppoint() {
    if (!appointUser) {
      setAppointError('Choose the account to appoint.');
      return;
    }
    setAppointBusy(true);
    setAppointError(null);
    try {
      await PlatformAdminService.grantPlatformAdmin(appointUser, appointLevel, appointNote.trim() || undefined);
      toast.success('Platform access granted');
      setAppointOpen(false);
      setAppointUser('');
      setAppointNote('');
      await load();
    } catch (cause) {
      setAppointError(messageOf(cause, 'The appointment was refused.'));
    } finally {
      setAppointBusy(false);
    }
  }

  async function submitLevel() {
    if (!levelTarget) return;
    setLevelBusy(true);
    setLevelError(null);
    try {
      await PlatformAdminService.setPlatformAdminLevel(levelTarget.userId, levelValue);
      toast.success('Level changed');
      setLevelTarget(null);
      await load();
    } catch (cause) {
      setLevelError(messageOf(cause, 'The change was refused.'));
    } finally {
      setLevelBusy(false);
    }
  }

  const columns = useMemo<DataTableColumn<PlatformAdminAccountV2>[]>(
    () => [
      {
        key: 'who',
        header: 'Account',
        label: '',
        render: (row) => (
          <div>
            <span className="font-medium text-ink break-words">{row.email}</span>
            {/* A revoked account is kept in the roster on purpose: it is the record of who had access. */}
            <p className="m-0 text-xs text-ink-3 break-words">{row.fullName ?? 'No name recorded'}</p>
            {row.note && <p className="m-0 text-xs text-ink-3 break-words">{row.note}</p>}
          </div>
        ),
      },
      {
        key: 'level',
        header: 'Level',
        sortValue: (row) => row.level,
        render: (row) => (
          <div>
            <StatusBadge status={row.level} />
            <p className="m-0 text-xs text-ink-3 break-words">
              {PLATFORM_LEVELS.find((entry) => entry.level === row.level)?.label ?? row.level}
            </p>
          </div>
        ),
      },
      { key: 'status', header: 'Status', sortValue: (row) => row.status, render: (row) => <StatusBadge status={row.status} /> },
      {
        key: 'permissions',
        header: 'Effective permissions',
        numeric: true,
        sortValue: (row) => row.permissionCount,
        render: (row) => (
          <div>
            <span className="font-medium text-ink break-words">
              {row.level === 'super_admin' ? 'All' : row.permissionCount}
            </span>
            <p className="m-0 text-xs text-ink-3 break-words">
              {row.level === 'super_admin' ? 'implicit to the level' : 'granted keys'}
            </p>
          </div>
        ),
      },
      {
        key: 'developer',
        header: 'Developer mode',
        render: (row) =>
          row.developerMode ? <Badge tone="workspace">active</Badge> : <span className="m-0 block text-xs text-ink-3 break-words">Not granted</span>,
      },
      {
        key: 'granted',
        header: 'Granted',
        sortValue: (row) => row.grantedAt,
        render: (row) => (
          <div>
            <span className="font-medium text-ink whitespace-nowrap">{formatRelative(row.grantedAt)}</span>
            <p className="m-0 text-xs text-ink-3 break-words">
              {row.grantedByEmail ? `by ${row.grantedByEmail}` : 'no granter recorded'}
            </p>
            {row.revokedAt && <p className="m-0 text-xs text-ink-3 break-words">Revoked {formatDateTime(row.revokedAt)}</p>}
          </div>
        ),
      },
      {
        key: 'actions',
        header: 'Actions',
        label: '',
        render: (row) => (
          <div className="data-table-cell-actions flex flex-wrap items-center justify-end gap-2">
            {row.status === 'active' ? (
              <>
                <Button
                  variant="outline"
                  className="btn-sm"
                  onClick={() => {
                    setLevelTarget(row);
                    setLevelValue(row.level);
                    setLevelError(null);
                  }}
                >
                  Change level
                </Button>
                <Button variant="danger" className="btn-sm" onClick={() => setRevokeTarget(row)}>
                  Revoke
                </Button>
              </>
            ) : (
              <span className="m-0 block text-xs text-ink-3 break-words">No access</span>
            )}
          </div>
        ),
      },
    ],
    [],
  );

  const explainerRows: DefRow[] = PLATFORM_LEVELS.map((entry) => ({
    term: entry.label,
    value: entry.summary,
  }));

  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface p-5 shadow-card [&>*+*]:mt-4 [&>.section-head+*]:mt-0" aria-labelledby="platform-roles">
      <SectionHead
        id="platform-roles"
        title="Platform users and roles"
        sub={`Who can operate ${APP_NAME} across all customer businesses, and what each of them can do.`}
        actions={
          <Button variant="outline" className="btn-sm" onClick={() => { setAppointOpen(true); setAppointError(null); }}>
            Appoint an admin
          </Button>
        }
      />

      <div className="mb-4 flex min-w-0 flex-col gap-0.5 rounded-lg border px-4 py-3 text-[13px] break-words border-brand-line bg-brand-soft/60">
        <div>
          <p className="m-0 text-sm font-semibold text-ink">A level is a starting point; the granted keys are the capability</p>
          <p className="m-0 text-[13px] text-ink-2">
            For every level except platform owner, this account can do exactly what its permission keys allow and
            nothing more — so a platform admin, a support agent and a developer differ only by which keys they hold.
            Platform owner is the exception: it holds every permission implicitly and is the only level that can
            appoint admins, change levels, revoke access or grant developer mode.
          </p>
        </div>
      </div>

      <SectionState
        loading={loading && accounts.length === 0}
        error={error}
        empty={accounts.length === 0}
        emptyTitle="No platform accounts"
        emptyBody="Nobody holds platform access, which should not be possible — the platform owner always does."
        onRetry={load}
      >
        <div className={tableBleed}>
          <DataTable
            columns={columns}
            rows={accounts}
            rowKey={(row) => row.userId}
            stacked
            caption="Platform admin accounts"
          />
        </div>
      </SectionState>

      <h3 className="m-0 mb-3 mt-6 text-sm font-semibold text-ink">What each level starts with</h3>
      <dl className="m-0 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {explainerRows.map((row) => (
          <div key={row.term} className="min-w-0 rounded-lg bg-subtle p-3.5">
            <dt className="text-[13px] font-semibold text-ink">{row.term}</dt>
            <dd className="m-0 mt-1 text-[13px] text-ink-2">{row.value}</dd>
          </div>
        ))}
      </dl>

      {/* ── Appoint ─────────────────────────────────────────────── */}
      <Dialog
        open={appointOpen}
        onClose={() => setAppointOpen(false)}
        title="Appoint a platform admin"
        description="The account is given the starting permissions for the level you choose, and can be changed afterwards."
        footer={
          <>
            <Button variant="outline" onClick={() => setAppointOpen(false)} disabled={appointBusy}>
              Cancel
            </Button>
            <Button loading={appointBusy} onClick={submitAppoint}>
              Grant access
            </Button>
          </>
        }
      >
        <div className="mb-4 flex min-w-0 flex-col gap-1.5">
          <label className="text-[13px] font-medium text-ink-2" htmlFor="appoint-user">Account</label>
          <select
            id="appoint-user"
            className="block h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 cursor-pointer pr-8"
            value={appointUser}
            onChange={(event) => setAppointUser(event.target.value)}
            disabled={appointBusy}
          >
            <option value="">Choose an account…</option>
            {appointable.map((candidate) => (
              <option key={candidate.userId} value={candidate.userId}>
                {candidate.email}
                {candidate.orgName ? ` — ${candidate.orgName}` : ''}
              </option>
            ))}
          </select>
          {appointable.length === 0 && (
            <p className="m-0 text-xs text-ink-3">
              No appointable accounts were returned. The list needs the same permission as this screen, so if it is
              empty either every user already holds platform access or the user list could not be read.
            </p>
          )}
        </div>

        <div className="mb-4 flex min-w-0 flex-col gap-1.5">
          <label className="text-[13px] font-medium text-ink-2" htmlFor="appoint-level">Level</label>
          <select
            id="appoint-level"
            className="block h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 cursor-pointer pr-8"
            value={appointLevel}
            onChange={(event) => setAppointLevel(event.target.value)}
            disabled={appointBusy}
          >
            {LEVEL_VALUES.map((level) => (
              <option key={level} value={level}>
                {PLATFORM_LEVELS.find((entry) => entry.level === level)?.label ?? level}
              </option>
            ))}
          </select>
          <p className="m-0 text-xs text-ink-3">
            {PLATFORM_LEVELS.find((entry) => entry.level === appointLevel)?.summary}
          </p>
        </div>

        <FormField
          id="appoint-note"
          label="Note (optional)"
          value={appointNote}
          onChange={setAppointNote}
          placeholder="Why this account is being appointed"
          error={appointError ?? undefined}
          disabled={appointBusy}
          hint="Stored on the account and written to the audit trail."
        />
      </Dialog>

      {/* ── Change level ────────────────────────────────────────── */}
      <Dialog
        open={levelTarget !== null}
        onClose={() => setLevelTarget(null)}
        title={`Change level for ${levelTarget?.email ?? ''}`}
        description="Moving to platform owner clears the explicit permissions, because that level already implies every one. Moving away seeds the new level's starting permissions."
        footer={
          <>
            <Button variant="outline" onClick={() => setLevelTarget(null)} disabled={levelBusy}>
              Cancel
            </Button>
            <Button loading={levelBusy} onClick={submitLevel}>
              Change level
            </Button>
          </>
        }
      >
        <div className="mb-4 flex min-w-0 flex-col gap-1.5">
          <label className="text-[13px] font-medium text-ink-2" htmlFor="level-value">New level</label>
          <select
            id="level-value"
            className="block h-10 w-full min-w-0 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 cursor-pointer pr-8"
            value={levelValue}
            onChange={(event) => setLevelValue(event.target.value)}
            disabled={levelBusy}
          >
            {LEVEL_VALUES.map((level) => (
              <option key={level} value={level}>
                {PLATFORM_LEVELS.find((entry) => entry.level === level)?.label ?? level}
              </option>
            ))}
          </select>
          <p className="m-0 text-xs text-ink-3">{PLATFORM_LEVELS.find((entry) => entry.level === levelValue)?.summary}</p>
        </div>

        {levelError && (
          <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border px-4 py-3 text-[13px] break-words border-danger/30 bg-danger-soft" role="alert">
            <div>
              <p className="m-0 text-sm font-semibold text-ink">The server refused this change</p>
              <p className="m-0 text-[13px] text-ink-2">{levelError}</p>
            </div>
          </div>
        )}
      </Dialog>

      {/* ── Revoke ──────────────────────────────────────────────── */}
      <ConfirmDialog
        open={revokeTarget !== null}
        onClose={() => setRevokeTarget(null)}
        onConfirm={async (reason) => {
          if (!revokeTarget) return;
          try {
            await PlatformAdminService.revokePlatformAdmin(revokeTarget.userId, reason);
            toast.success('Platform access revoked');
            setRevokeTarget(null);
            await load();
          } catch (cause) {
            throw new Error(messageOf(cause, 'The revocation was refused.'));
          }
        }}
        title={`Revoke platform access for ${revokeTarget?.email ?? ''}`}
        confirmLabel="Revoke access"
        danger
        requireReason
        reasonLabel="Reason (required)"
        reasonHint="Recorded in the audit trail. The server refuses fewer than five characters."
        consequence={
          <>
            This account loses every platform permission, its developer access is revoked and any open developer
            session is ended. Both legacy platform flags are cleared as well, so it cannot read platform data through
            row-level security either. The account itself is not deleted, and its customer businesses are untouched —
            the roster keeps the row so there is a record of who had access and when.
          </>
        }
      />

      <p className="m-0 mt-4 text-xs text-ink-3">
        Every appointment, level change and revocation is written to the audit trail with the reason given. The
        platform refuses to demote or revoke its last owner, and refuses self-revocation, so the console cannot be
        locked out of its own administration.
      </p>
    </section>
  );
}
