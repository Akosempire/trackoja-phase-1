import { SearchInput } from '../../../components/ui/SearchInput';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PlatformAdminService,
  type ProductBusiness,
  type SupportNote,
} from '../../../services/platformAdmin.service';
import { usePlatform } from '../../../components/platform/PlatformContext';
import {
  AreaCoverage,
  PermissionDenied,
  PlatformPageHead,
  RefreshButton,
} from '../../../components/platform/PlatformPageHead';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { DefList } from '../../../components/ui/DefList';
import { Dialog } from '../../../components/ui/Dialog';
import { Disclosure } from '../../../components/ui/Disclosure';
import { SectionHead } from '../../../components/ui/SectionHead';
import { StateBlock } from '../../../components/ui/StateBlock';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { Timeline, type TimelineEntry } from '../../../components/ui/Timeline';
import { useToast } from '../../../components/ui/Toast';
import { PLATFORM_AREAS } from '../../../config/platformAreas';
import { formatDateTime, formatNumber, formatRelative, humaniseToken } from '../../../utils/format';

const AREA = PLATFORM_AREAS.find((area) => area.id === 'support')!;

/**
 * Every note type the database will accept, restating the CHECK constraint on
 * platform_support_notes.note_type that `add_support_note` re-validates. The
 * select is built from this list rather than free text so a note cannot be
 * rejected for a reason the operator cannot see coming.
 */
const NOTE_TYPES = [
  'note',
  'support_action',
  'suspension',
  'reinstatement',
  'manual_activation',
  'pricing_change',
  'contact',
  'developer_test',
] as const;

/**
 * The exact schema the ticket capability needs. None of it exists: no
 * `support_tickets` or `support_ticket_messages` table and no ticket RPC in any
 * migration in this repository.
 */
const TICKET_SCHEMA_SQL = `-- NOT PRESENT IN THIS REPOSITORY. Specification only.
CREATE TABLE public.support_tickets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         TEXT NOT NULL UNIQUE,   -- quotable, e.g. SUP-2026-00041
  org_id            UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  product_id        UUID REFERENCES public.platform_products(id) ON DELETE SET NULL,
  requester_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  requester_email   TEXT NOT NULL,          -- kept even if the user is deleted
  subject           TEXT NOT NULL,
  category          TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('billing','account','bug','how_to','feature_request','other')),
  severity          TEXT NOT NULL DEFAULT 'normal'
    CHECK (severity IN ('low','normal','high','urgent')),
  status            TEXT NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','open','pending_customer','pending_internal','resolved','closed')),
  assignee_user_id  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  first_response_at TIMESTAMPTZ,            -- set on the first customer-visible reply
  resolved_at       TIMESTAMPTZ,
  is_sandbox        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_support_tickets_queue
  ON public.support_tickets(status, severity, created_at DESC);
CREATE INDEX idx_support_tickets_org
  ON public.support_tickets(org_id, created_at DESC);

CREATE TABLE public.support_ticket_messages (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id      UUID NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  author_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  author_email   TEXT,
  -- 'internal' must never leave the server for a business-side caller.
  visibility     TEXT NOT NULL DEFAULT 'internal'
    CHECK (visibility IN ('internal','customer')),
  body           TEXT NOT NULL,
  attachments    JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_support_ticket_messages_thread
  ON public.support_ticket_messages(ticket_id, created_at);`;

const TICKET_RPCS: { term: string; value: string }[] = [
  {
    term: 'create_support_ticket',
    value:
      'p_org_id, p_subject, p_body, p_category, p_severity, p_requester_email → support_tickets. ' +
      'The only path by which a business owner can open a conversation.',
  },
  {
    term: 'list_support_tickets',
    value:
      'p_status, p_severity, p_assignee_user_id, p_org_id, p_limit, p_offset → queue rows with ' +
      'reference, subject, category, severity, status, assignee, age and first_response_at.',
  },
  {
    term: 'get_support_ticket',
    value:
      'p_ticket_id → the ticket plus its messages, filtered by caller: a platform admin sees ' +
      'internal and customer rows, a business-side caller sees only visibility = customer.',
  },
  {
    term: 'assign_support_ticket',
    value: 'p_ticket_id, p_assignee_user_id → sets the assignee and writes an audit row.',
  },
  {
    term: 'set_support_ticket_status',
    value:
      'p_ticket_id, p_status → one-way transitions validated server-side; stamps resolved_at when ' +
      'moving to resolved, and requires a note when closing without a customer-visible reply.',
  },
  {
    term: 'add_ticket_message',
    value:
      'p_ticket_id, p_body, p_visibility, p_attachments → appends to the thread; sets ' +
      'first_response_at on the first customer-visible reply.',
  },
  {
    term: 'support_ticket_stats',
    value:
      'p_from, p_to → counts by category, unresolved counts by severity, median first-response ' +
      'time and a resolved-per-day series.',
  },
];

/**
 * Real support data, read from the two RPCs that exist.
 *
 * `listBusinesses` feeds the picker; `listSupportNotes` reads the notes for the
 * chosen business. Both throw on failure and the messages are shown as-is,
 * because a support surface that swallows a permission error is worse than one
 * that shows it.
 */
function useSupportData(search: string) {
  const [businesses, setBusinesses] = useState<ProductBusiness[]>([]);
  const [selected, setSelected] = useState<ProductBusiness | null>(null);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState<string | null>(null);

  const loadDirectory = useCallback(async () => {
    setDirectoryLoading(true);
    setDirectoryError(null);
    try {
      const rows = await PlatformAdminService.listBusinesses({
        search: search || undefined,
        limit: 200,
      });
      setBusinesses(rows);
      // The notes panel needs a business to read; keep the current choice while
      // it is still in the result set, otherwise fall to the first row rather
      // than silently reading another business's notes under a stale heading.
      setSelected((current) => {
        if (current && rows.some((row) => row.orgId === current.orgId)) return current;
        return rows[0] ?? null;
      });
    } catch (cause) {
      setBusinesses([]);
      setSelected(null);
      setDirectoryError(cause instanceof Error ? cause.message : 'Could not list businesses.');
    } finally {
      setDirectoryLoading(false);
    }
  }, [search]);

  useEffect(() => {
    void loadDirectory();
  }, [loadDirectory]);

  const [notes, setNotes] = useState<SupportNote[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  const orgId = selected?.orgId ?? null;

  const loadNotes = useCallback(async () => {
    if (!orgId) {
      setNotes([]);
      setNotesError(null);
      return;
    }
    setNotesLoading(true);
    setNotesError(null);
    try {
      setNotes(await PlatformAdminService.listSupportNotes(orgId, 100));
    } catch (cause) {
      setNotes([]);
      setNotesError(cause instanceof Error ? cause.message : 'Could not load support notes.');
    } finally {
      setNotesLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  return {
    businesses,
    selected,
    setSelected,
    directoryLoading,
    directoryError,
    reloadDirectory: loadDirectory,
    notes,
    notesLoading,
    notesError,
    reloadNotes: loadNotes,
  };
}

export default function SupportArea() {
  const { can } = usePlatform();
  const toast = useToast();
  const allowed = can('platform:support');

  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const {
    businesses,
    selected,
    setSelected,
    directoryLoading,
    directoryError,
    reloadDirectory,
    notes,
    notesLoading,
    notesError,
    reloadNotes,
  } = useSupportData(search);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [noteType, setNoteType] = useState<string>(NOTE_TYPES[0]);
  const [noteBody, setNoteBody] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * `list_support_notes` already orders by created_at DESC, so the timeline is
   * newest-first without re-sorting in the browser. The sandbox flag comes from
   * the note row itself, because the flag is frozen at write time.
   */
  const noteEntries = useMemo<TimelineEntry[]>(
    () =>
      notes.map((note) => ({
        id: note.id,
        title: humaniseToken(note.noteType),
        meta: (
          <>
            {note.adminEmail ?? 'Admin account no longer present'} ·{' '}
            {note.productKey ? humaniseToken(note.productKey) : 'No product attached'} ·{' '}
            {formatDateTime(note.createdAt)} ({formatRelative(note.createdAt)})
            {note.isSandbox && (
              <>
                {' '}
                <Badge tone="workspace">sandbox</Badge>
              </>
            )}
          </>
        ),
        text: note.body,
        tone: note.noteType === 'suspension' ? 'danger' : note.noteType === 'reinstatement' ? 'success' : 'accent',
      })),
    [notes],
  );

  function openDialog() {
    setNoteType(NOTE_TYPES[0]);
    setNoteBody('');
    setNoteError(null);
    setDialogOpen(true);
  }

  async function submitNote() {
    if (!selected) return;
    const body = noteBody.trim();
    if (body.length === 0) {
      setNoteError('A support note needs a body: add_support_note rejects an empty one.');
      return;
    }
    setSaving(true);
    setNoteError(null);
    try {
      // No optimistic insertion: the row is only real once the insert returns,
      // and the list is re-read so what is shown is what the database holds.
      await PlatformAdminService.addSupportNote({
        orgId: selected.orgId,
        body,
        noteType,
      });
      setDialogOpen(false);
      await reloadNotes();
      toast.success('Note recorded', { description: `${humaniseToken(noteType)} on ${selected.name}` });
    } catch (cause) {
      // The server's own message: a permission refusal or a rejected note type
      // has to reach the operator unchanged.
      setNoteError(cause instanceof Error ? cause.message : 'Could not record the note.');
    } finally {
      setSaving(false);
    }
  }

  if (!allowed) {
    return (
      <>
        <PlatformPageHead area={AREA} />
        <PermissionDenied what="support notes" permission="platform:support" />
      </>
    );
  }

  return (
    <>
      <PlatformPageHead
        area={AREA}
        description="Notes recorded against a business, and the ticket backend this area has none of."
        actions={
          <RefreshButton
            onClick={() => {
              void reloadDirectory();
              void reloadNotes();
            }}
            loading={directoryLoading || notesLoading}
          />
        }
      />

      <AreaCoverage gaps={AREA.gaps} title="What this page cannot do yet" />

      {/* ── Tickets: the contract, not a placeholder ──────────────── */}
      <section className="card" aria-labelledby="support-tickets">
        <SectionHead id="support-tickets" title="Support tickets" />

        <StateBlock
          variant="unavailable"
          title="Not configured"
          body={
            <>
              There is no support ticket backend: no <span className="mono">support_tickets</span> table, no
              ticket RPC and no inbound channel, so a business owner cannot open a conversation and an
              operator has nothing to queue.
            </>
          }
        />

        <Disclosure summary="What the backend would need">
          <pre className="code-panel">{TICKET_SCHEMA_SQL}</pre>
          <DefList
            rows={TICKET_RPCS.map((rpc) => ({
              term: rpc.term,
              value: rpc.value,
            }))}
          />
          <p className="plat-note">
            <span className="mono">support_ticket_messages.visibility</span> must be applied in SQL by{' '}
            <span className="mono">get_support_ticket</span>: sending internal rows to the browser and hiding
            them with CSS leaves the text in the network response. <span className="mono">list_support_notes</span>{' '}
            already decides access before it selects anything.
          </p>
        </Disclosure>

        <Disclosure summary="Ticket vocabulary already agreed">
          <DefList
            rows={[
              {
                term: 'Ticket status',
                value: (
                  <>
                    <StatusBadge status="new" /> <StatusBadge status="open" />{' '}
                    <StatusBadge status="pending_customer" /> <StatusBadge status="resolved" />{' '}
                    <StatusBadge status="closed" />
                  </>
                ),
              },
              {
                term: 'Severity',
                value: (
                  <>
                    <StatusBadge status="low" /> <StatusBadge status="normal" />{' '}
                    <StatusBadge status="high" /> <StatusBadge status="urgent" />
                  </>
                ),
              },
              {
                term: 'Category',
                value: (
                  <>
                    <StatusBadge status="billing" /> <StatusBadge status="account" />{' '}
                    <StatusBadge status="bug" /> <StatusBadge status="how_to" />{' '}
                    <StatusBadge status="feature_request" /> <StatusBadge status="other" />
                  </>
                ),
              },
            ]}
          />
        </Disclosure>

        <p className="form-hint">
          Ticket actions would require <span className="mono">platform:manage_tickets</span> — declared, but
          nothing consumes it — so this page requires only <span className="mono">platform:support</span>.
        </p>
      </section>

      {/* ── Notes: real reads and a real write ────────────────────── */}
      <section className="card" aria-labelledby="support-notes">
        <SectionHead
          id="support-notes"
          title="Support notes"
          sub="The only support record that exists, and it is append-only."
          actions={
            <Button variant="outline" className="btn-sm" onClick={openDialog} disabled={!selected}>
              Add note
            </Button>
          }
        />

        <form
          className="toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(searchDraft.trim());
          }}
        >
          <div className="toolbar-grow">
            <label className="form-label" htmlFor="support-business-search">
              Find a business
            </label>
            <SearchInput aria-label="Search businesses"
              id="support-business-search"


              value={searchDraft}
              placeholder="Name, owner email or slug"
              onChange={(event) => setSearchDraft(event.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-neutral btn-sm">
            <span className="btn-label">Search</span>
          </button>
          {search !== '' && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setSearchDraft('');
                setSearch('');
              }}
            >
              <span className="btn-label">Clear</span>
            </button>
          )}
        </form>

        {directoryError ? (
          <StateBlock
            variant="error"
            title="Could not list businesses"
            body={directoryError}
            actions={
              <button type="button" className="btn btn-outline btn-sm" onClick={() => void reloadDirectory()}>
                <span className="btn-label">Try again</span>
              </button>
            }
          />
        ) : directoryLoading ? (
          <div className="skeleton-inline" role="status" aria-label="Loading businesses">
            <span className="skeleton skeleton-text" />
            <span className="skeleton skeleton-text is-short" />
          </div>
        ) : businesses.length === 0 ? (
          <StateBlock
            variant="empty"
            title={search ? 'No business matches that search' : 'No businesses returned'}
            body={
              search
                ? 'Searched by name, owner email and slug; clear the search to widen it.'
                : 'The business directory returned no rows, so there is nothing to attach a note to.'
            }
          />
        ) : (
          <div className="toolbar">
            <div className="plat-field plat-field-grow">
              <label className="form-label" htmlFor="support-business">
                Business
              </label>
              <select
                id="support-business"
                className="select-input"
                value={selected?.orgId ?? ''}
                onChange={(event) => {
                  const next = businesses.find((row) => row.orgId === event.target.value) ?? null;
                  setSelected(next);
                }}
              >
                {/* The chosen business stays selectable even when a search hides
                    it, so the notes below never belong to a different heading. */}
                {selected && !businesses.some((row) => row.orgId === selected.orgId) && (
                  <option value={selected.orgId}>{selected.name} (outside this search)</option>
                )}
                {businesses.map((row) => (
                  <option key={row.orgId} value={row.orgId}>
                    {row.name}
                    {row.isSandbox ? ' — sandbox' : ''}
                  </option>
                ))}
              </select>
              <p className="form-hint">
                {formatNumber(businesses.length)} business{businesses.length === 1 ? '' : 'es'} listed by{' '}
                <span className="mono">list_product_businesses</span>
                {search ? ' for this search' : ''}.
              </p>
            </div>
          </div>
        )}

        {selected && (
          <div className="plat-section">
            <DefList
              rows={[
                { term: 'Business', value: selected.name },
                { term: 'Owner', value: selected.ownerEmail ?? 'No owner email on file' },
                { term: 'Product', value: humaniseToken(selected.productKey) },
                {
                  term: 'Sandbox',
                  value: selected.isSandbox ? <Badge tone="workspace">sandbox</Badge> : 'No',
                },
                {
                  term: 'Notes on record',
                  value: notesLoading ? '—' : formatNumber(notes.length),
                },
              ]}
            />
          </div>
        )}

        {notesError ? (
          <StateBlock
            variant="error"
            title="Could not load support notes"
            body={notesError}
            actions={
              <button type="button" className="btn btn-outline btn-sm" onClick={() => void reloadNotes()}>
                <span className="btn-label">Try again</span>
              </button>
            }
          />
        ) : selected ? (
          <>
            <div className="callout callout-info">
              <div>
                <p className="callout-title">Notes are append-only</p>
                <p className="callout-text">
                  There is no edit and no delete path, so a correction means another note — the original stays
                  in the history.
                </p>
              </div>
            </div>

            {notesLoading ? (
              <div className="skeleton-inline" role="status" aria-label="Loading notes">
                <span className="skeleton skeleton-text" />
                <span className="skeleton skeleton-text" />
                <span className="skeleton skeleton-text is-short" />
              </div>
            ) : (
              <Timeline items={noteEntries} />
            )}
          </>
        ) : (
          <StateBlock
            variant="empty"
            title="Choose a business"
            body="Support notes are attached to a business."
          />
        )}
      </section>

      {/* ── Triage and trend: not measurable, said plainly ────────── */}
      <section className="card" aria-labelledby="support-triage">
        <SectionHead id="support-triage" title="Frequent issues and urgent backlog" />

        <StateBlock
          variant="unavailable"
          title="Not configured"
          body={
            <>
              Neither figure is measurable: there are no tickets, so there is no category, severity, status
              or assignee to count. An empty chart here would read as &quot;zero urgent issues&quot;, which
              is a claim this application cannot make.
            </>
          }
        />

        <Disclosure summary="What the backend would need">
          <pre className="code-panel">{`-- NOT PRESENT IN THIS REPOSITORY. Specification only.
support_ticket_stats(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ) RETURNS TABLE (
  category              TEXT,     -- billing | account | bug | how_to | feature_request | other
  opened                BIGINT,   -- opened inside the window
  resolved              BIGINT,   -- resolved inside the window
  unresolved            BIGINT,   -- still new/open/pending_* at p_to
  unresolved_urgent     BIGINT,   -- unresolved AND severity IN ('high','urgent')
  median_first_response INTERVAL, -- created_at -> first_response_at, customer-visible only
  day                   DATE      -- one row per day, so the trend is a series not a total
);`}</pre>
          <p className="plat-note">
            Until that function exists, the only support figures on this page are the note counts above, which
            count administrative notes and not customer issues.
          </p>
        </Disclosure>
      </section>

      <p className="section-sub">
        The business directory is read through <span className="mono">list_product_businesses</span> and lists
        only businesses that hold an entitlement row. Notes shown are the 100 most recent for the selected
        business.
      </p>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={selected ? `Add a support note to ${selected.name}` : 'Add a support note'}
        description="Written to platform_support_notes and attributed to you in the audit trail."
        footer={
          <>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button loading={saving} onClick={() => void submitNote()} disabled={!selected}>
              Add note
            </Button>
          </>
        }
      >
        <div className="form-group">
          <label className="form-label" htmlFor="support-note-type">
            Note type
          </label>
          <select
            id="support-note-type"
            className="select-input"
            value={noteType}
            onChange={(event) => setNoteType(event.target.value)}
            disabled={saving}
          >
            {NOTE_TYPES.map((value) => (
              <option key={value} value={value}>
                {humaniseToken(value)}
              </option>
            ))}
          </select>
          <p className="form-hint">Stored as written; there is no update path.</p>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="support-note-body">
            Note
          </label>
          <textarea
            id="support-note-body"
            className="form-input"
            value={noteBody}
            onChange={(event) => setNoteBody(event.target.value)}
            disabled={saving}
            aria-invalid={noteError ? true : undefined}
            aria-describedby={noteError ? 'support-note-error' : undefined}
          />
          {noteError && (
            <p className="form-error" id="support-note-error" role="alert">
              {noteError}
            </p>
          )}
        </div>

        <div className="callout callout-warning">
          <div>
            <p className="callout-title">This cannot be edited or deleted</p>
            <p className="callout-text">
              A correction means another note. The audit row records the note type and who wrote it, not the
              text.
            </p>
          </div>
        </div>
      </Dialog>
    </>
  );
}
