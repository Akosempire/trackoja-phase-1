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
import { SectionHead } from '../../../components/ui/SectionHead';
import { StateBlock } from '../../../components/ui/StateBlock';
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
 * Real support data, read from the two RPCs that exist.
 *
 * `listBusinesses` feeds the picker; `listSupportNotes` reads the notes for the
 * chosen business. Both throw on failure and the messages are shown as-is,
 * because a support surface that swallows a permission error is worse than one
 * that shows it.
 */
function useSupportData(search: string, allowed: boolean) {
  const [businesses, setBusinesses] = useState<ProductBusiness[]>([]);
  const [selected, setSelected] = useState<ProductBusiness | null>(null);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [directoryError, setDirectoryError] = useState<string | null>(null);

  const loadDirectory = useCallback(async () => {
    if (!allowed) return;
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
  }, [search, allowed]);

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
  } = useSupportData(search, allowed);

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
      setNoteError('Enter a note before saving.');
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
        description="Find a business and record internal support notes."
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

      <section className="card" aria-labelledby="support-notes">
        <SectionHead
          id="support-notes"
          title="Support notes"
          sub="Internal history for the selected business."
          actions={
            <Button className="btn-sm" onClick={openDialog} disabled={!selected}>
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
                {formatNumber(businesses.length)} business{businesses.length === 1 ? '' : 'es'} found
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
                  value: notesError ? 'Unavailable' : notesLoading ? '—' : formatNumber(notes.length),
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

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title={selected ? `Add a support note to ${selected.name}` : 'Add a support note'}
        description="Visible to platform staff and recorded in the audit trail."
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
          <p className="form-hint">Choose the reason for this note.</p>
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
