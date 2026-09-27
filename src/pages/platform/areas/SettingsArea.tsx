import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  PlatformAdminService,
  type NotificationTemplate,
  type PlatformSetting,
} from '../../../services/platformAdmin.service';
import { usePlatform } from '../../../components/platform/PlatformContext';
import { AreaCoverage, PlatformPageHead, RefreshButton } from '../../../components/platform/PlatformPageHead';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { DataTable, type DataTableColumn } from '../../../components/ui/DataTable';
import { Disclosure } from '../../../components/ui/Disclosure';
import { Dialog } from '../../../components/ui/Dialog';
import { SectionHead } from '../../../components/ui/SectionHead';
import { SectionState } from '../../../components/ui/StateBlock';
import { StatusBadge } from '../../../components/ui/StatusBadge';
import { useToast } from '../../../components/ui/Toast';
import { PLATFORM_AREAS } from '../../../config/platformAreas';
import { ENVIRONMENT_SETTING_KEY } from '../../../config/environment';
import { formatDateTime, formatRelative } from '../../../utils/format';

const AREA = PLATFORM_AREAS.find((area) => area.id === 'settings')!;

const TEMPLATE_CHANNELS = ['email', 'sms', 'in_app'] as const;

/**
 * The only seeded key any code reads.
 *
 * Verified by reading the migrations rather than inferred from the key name: it
 * is the guard inside assert_sandbox_override() in
 * 20260926000072_platform_developer_mode_functions.sql. Every other seeded key is
 * written and returned but consulted by nothing, which each row states as a badge
 * rather than as a paragraph.
 */
const READ_BY_CODE: Record<string, string> = {
  'developer.sandbox_required':
    'assert_sandbox_override(), 20260926000072_platform_developer_mode_functions.sql',
};

/**
 * Why the keys no code reads are inert.
 *
 * Kept for the disclosure rather than the row: the badge is what the operator
 * needs while scanning, and the reason is what they need if they are about to
 * change the value anyway.
 */
const INERT_NOTES: { key: string; note: string }[] = [
  {
    key: 'billing.trial_days',
    note: 'Trial length comes from a plan entitlement’s own metadata, not from this key.',
  },
  {
    key: 'billing.annual_months_free',
    note: 'No code computes an annual price from this value.',
  },
  {
    key: 'billing.currency',
    note: 'Plans carry their own currency column, which is what billing uses.',
  },
  {
    key: 'products.trackoja.visible',
    note: 'Duplicates platform_products.visibility for the same product — two sources of truth for one question.',
  },
  {
    key: 'products.trackoja_works.visible',
    note: 'Duplicates platform_products.visibility for the same product.',
  },
  {
    key: 'activation.keys_enabled',
    note: 'Issuing and redeeming activation keys is not gated on this key, so turning it off does not disable keys.',
  },
  {
    key: 'products.trackoja.tiers_public',
    note: 'Which tiers are advertised comes from product_plans.is_public, so editing this list changes nothing.',
  },
];

/** Categories are grouped by whether the platform behaves according to them. */
const GROUPS: { id: string; title: string; categories: string[] }[] = [
  {
    id: 'operational',
    title: 'Operational configuration',
    categories: ['payments', 'activation', 'developer', 'notifications', 'general'],
  },
  {
    id: 'branding',
    title: 'Branding and content',
    categories: ['products'],
  },
];

const CATEGORY_LABEL: Record<string, string> = {
  payments: 'Billing and payments',
  activation: 'Activation keys',
  developer: 'Developer mode',
  notifications: 'Notifications',
  general: 'General',
  products: 'Product visibility',
};

/** The string a control starts from for a stored JSON value. */
function controlValue(sample: unknown): string {
  if (typeof sample === 'string') return sample;
  if (typeof sample === 'boolean') return sample ? 'true' : 'false';
  if (typeof sample === 'number') return String(sample);
  return JSON.stringify(sample);
}

type ParseResult = { value: unknown; error?: undefined } | { value?: undefined; error: string };

/**
 * Parses one control back into the JSON the server will accept.
 *
 * set_platform_setting() requires the replacement to have the same jsonb type as
 * the stored value, so the parse is driven by the existing value rather than by
 * guessing from the text.
 */
function parseLike(raw: string, sample: unknown): ParseResult {
  if (sample === null) {
    return {
      error:
        'This value is stored as null. The server refuses a null value, so it cannot be rewritten from this screen.',
    };
  }
  if (typeof sample === 'boolean') {
    if (raw !== 'true' && raw !== 'false') return { error: 'Choose true or false.' };
    return { value: raw === 'true' };
  }
  if (typeof sample === 'number') {
    if (raw.trim() === '') return { error: 'Enter a number.' };
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return { error: 'Enter a valid number.' };
    return { value: parsed };
  }
  if (typeof sample === 'string') return { value: raw };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { error: 'Enter valid JSON with the same shape as the stored value.' };
  }
  if (Array.isArray(sample)) {
    if (!Array.isArray(parsed)) return { error: 'The stored value is a list, so the replacement must be a list.' };
    return { value: parsed };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { error: 'The stored value is an object, so the replacement must be an object.' };
  }
  return { value: parsed };
}

/** One editable control for a stored JSON value. */
function ValueControl({
  id,
  label,
  sample,
  value,
  disabled,
  hideLabel,
  onChange,
}: {
  id: string;
  label: string;
  sample: unknown;
  value: string;
  disabled: boolean;
  /** Used where the setting key is already the row title, so the label is repeated
   *  visually; it stays in the accessibility tree either way. */
  hideLabel?: boolean;
  onChange: (value: string) => void;
}) {
  // The label element may wrap a paragraph for a null value, so it is only used
  // for the control branches below and rendered separately there.
  const labelClass = hideLabel ? 'form-label sr-only' : 'form-label';

  if (sample === null) {
    return (
      <p className="is-locked" id={id}>
        {hideLabel ? 'Value' : label}: stored as null and cannot be rewritten here.
      </p>
    );
  }

  if (typeof sample === 'boolean') {
    return (
      <>
        <label className={labelClass} htmlFor={id}>
          {label}
        </label>
        <select
          id={id}
          className="select-input"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      </>
    );
  }

  return (
    <>
      <label className={labelClass} htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className={typeof sample === 'number' ? 'form-input' : 'form-input mono'}
        type={typeof sample === 'number' ? 'number' : 'text'}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </>
  );
}

interface TemplateDraft {
  /** Null while creating, so the key stays editable only for a new template. */
  existingKey: string | null;
  key: string;
  name: string;
  channel: string;
  subject: string;
  body: string;
  status: string;
}

export default function SettingsArea() {
  const toast = useToast();
  const { can } = usePlatform();
  const canManage = can('platform:manage_settings');

  const [settings, setSettings] = useState<PlatformSetting[]>([]);
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const [templateDraft, setTemplateDraft] = useState<TemplateDraft | null>(null);
  const [templateFormError, setTemplateFormError] = useState<string | null>(null);
  const [savingTemplate, setSavingTemplate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setTemplateError(null);

    const [settingsResult, templatesResult] = await Promise.allSettled([
      PlatformAdminService.listSettings(),
      PlatformAdminService.listNotificationTemplates(),
    ]);

    if (settingsResult.status === 'fulfilled') {
      setSettings(settingsResult.value);
    } else {
      setSettings([]);
      setError(
        settingsResult.reason instanceof Error
          ? settingsResult.reason.message
          : 'Could not load platform settings.',
      );
    }

    if (templatesResult.status === 'fulfilled') {
      setTemplates(templatesResult.value);
    } else {
      setTemplates([]);
      setTemplateError(
        templatesResult.reason instanceof Error
          ? templatesResult.reason.message
          : 'Could not load notification templates.',
      );
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Builds the JSON to write for a setting.
   *
   * An object keeps its shape: only keys the stored value already declares are
   * read from the drafts, which mirrors the server rule that a setting cannot gain
   * a key through this function.
   */
  function encodeSetting(setting: PlatformSetting): ParseResult {
    const value = setting.value;

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const next: Record<string, unknown> = {};
      for (const objectKey of Object.keys(record)) {
        const raw = drafts[`${setting.key}::${objectKey}`] ?? controlValue(record[objectKey]);
        const parsed = parseLike(raw, record[objectKey]);
        if (parsed.error) return { error: `${objectKey}: ${parsed.error}` };
        next[objectKey] = parsed.value;
      }
      return { value: next };
    }

    const raw = drafts[setting.key] ?? controlValue(value);
    return parseLike(raw, value);
  }

  async function saveSetting(setting: PlatformSetting) {
    const encoded = encodeSetting(setting);
    if (encoded.error) {
      setRowErrors((current) => ({ ...current, [setting.key]: encoded.error as string }));
      return;
    }

    setSavingKey(setting.key);
    setRowErrors((current) => {
      const next = { ...current };
      delete next[setting.key];
      return next;
    });

    try {
      await PlatformAdminService.setSetting(setting.key, encoded.value);
      toast.success(`${setting.key} saved`, { description: 'Written to the audit trail.' });
      // The stored value is the authority, so it is re-read rather than assumed.
      await load();
      setDrafts((current) => {
        const next = { ...current };
        for (const key of Object.keys(next)) {
          if (key === setting.key || key.startsWith(`${setting.key}::`)) delete next[key];
        }
        return next;
      });
    } catch (cause) {
      // The server's own refusal, verbatim: it names the rule that was broken.
      setRowErrors((current) => ({
        ...current,
        [setting.key]: cause instanceof Error ? cause.message : 'The server refused this change.',
      }));
    } finally {
      setSavingKey(null);
    }
  }

  function isDirty(setting: PlatformSetting): boolean {
    const value = setting.value;
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      return Object.keys(record).some((objectKey) => {
        const draft = drafts[`${setting.key}::${objectKey}`];
        return draft !== undefined && draft !== controlValue(record[objectKey]);
      });
    }
    const draft = drafts[setting.key];
    return draft !== undefined && draft !== controlValue(value);
  }

  const grouped = useMemo(() => {
    const known = new Set(GROUPS.flatMap((group) => group.categories));
    const leftovers = [...new Set(settings.map((setting) => setting.category))].filter(
      (category) => !known.has(category),
    );

    return [
      ...GROUPS.map((group) => ({
        ...group,
        entries: group.categories
          .map((category) => ({
            category,
            rows: settings.filter((setting) => setting.category === category),
          }))
          .filter((entry) => entry.rows.length > 0),
      })),
      // Categories this build does not know are shown rather than hidden, so a row
      // added to the table by hand can never be invisible on this screen.
      ...(leftovers.length > 0
        ? [
            {
              id: 'other',
              title: 'Other categories',
              entries: leftovers.map((category) => ({
                category,
                rows: settings.filter((setting) => setting.category === category),
              })),
            },
          ]
        : []),
    ];
  }, [settings]);

  const templateColumns = useMemo<DataTableColumn<NotificationTemplate>[]>(
    () => [
      {
        key: 'name',
        header: 'Template',
        label: '',
        sortValue: (row) => row.name.toLowerCase(),
        render: (row) => (
          <div>
            <span className="data-table-primary">{row.name}</span>
            <p className="data-table-secondary mono">{row.key}</p>
          </div>
        ),
      },
      {
        key: 'channel',
        header: 'Channel',
        sortValue: (row) => row.channel,
        render: (row) => <Badge tone="outline">{row.channel}</Badge>,
      },
      {
        key: 'subject',
        header: 'Subject',
        render: (row) => row.subject ?? <span className="data-table-secondary">Not set</span>,
      },
      {
        key: 'status',
        header: 'Status',
        sortValue: (row) => row.status,
        render: (row) => <StatusBadge status={row.status} />,
      },
      {
        key: 'updated',
        header: 'Last updated',
        sortValue: (row) => row.updatedAt ?? '',
        render: (row) =>
          row.updatedAt ? (
            <div>
              <span className="data-table-primary">{formatDateTime(row.updatedAt)}</span>
              <p className="data-table-secondary">{formatRelative(row.updatedAt)}</p>
            </div>
          ) : (
            <span className="data-table-secondary">—</span>
          ),
      },
      {
        key: 'actions',
        header: 'Actions',
        nowrap: true,
        render: (row) => (
          <Button
            variant="outline"
            className="btn-sm"
            disabled={!canManage}
            onClick={() =>
              setTemplateDraft({
                existingKey: row.key,
                key: row.key,
                name: row.name,
                channel: row.channel,
                subject: row.subject ?? '',
                body: row.body,
                status: row.status,
              })
            }
          >
            Edit
          </Button>
        ),
      },
    ],
    [canManage],
  );

  async function saveTemplate() {
    if (!templateDraft) return;
    const draft = templateDraft;

    if (!draft.key.trim()) {
      setTemplateFormError('A template key is required.');
      return;
    }
    if (!draft.name.trim()) {
      setTemplateFormError('A template name is required.');
      return;
    }
    if (!draft.body.trim()) {
      setTemplateFormError('A template body is required: the server refuses an empty one.');
      return;
    }

    setSavingTemplate(true);
    setTemplateFormError(null);
    try {
      await PlatformAdminService.upsertNotificationTemplate({
        key: draft.key.trim(),
        name: draft.name.trim(),
        channel: draft.channel,
        subject: draft.subject.trim() || null,
        body: draft.body,
        status: draft.status,
      });
      toast.success(`${draft.key.trim()} saved`, {
        description: 'Stored only; nothing sends it.',
      });
      setTemplateDraft(null);
      await load();
    } catch (cause) {
      setTemplateFormError(cause instanceof Error ? cause.message : 'The server refused this template.');
    } finally {
      setSavingTemplate(false);
    }
  }

  return (
    <>
      <PlatformPageHead
        area={AREA}
        description={
          canManage
            ? 'Existing settings only: the server refuses a new key, a new object key and anything credential-shaped.'
            : 'Read-only: this account does not hold platform:manage_settings.'
        }
        actions={<RefreshButton onClick={load} loading={loading} />}
      />

      <AreaCoverage gaps={AREA.gaps} title="What this screen cannot do" />

      {/* ── How these settings behave ───────────────────────────────── */}
      <section className="card" aria-labelledby="settings-rules">
        <SectionHead
          id="settings-rules"
          title="How these settings behave"
          sub="A row marked read by nothing is stored and editable but changes no behaviour."
        />

        <Disclosure summary="What the server refuses, and which keys anything reads">
          <p>
            <span className="mono">set_platform_setting()</span> (rewritten in migration 089, section 7.5) cannot create a
            setting: an unknown key is refused outright. It cannot add a key to an object value, because the replacement must not define a key the stored
            value does not, and it refuses a value whose JSON type differs from the stored one. Any key or value matching{' '}
            <span className="mono">secret|password|token|api_key|private_key|service_role</span> is refused — credentials
            belong in server-side secret storage, which is why this screen offers no field for them. A refused save shows
            the server&rsquo;s own message on the row.
          </p>

          <p className="section-sub">
            One seeded key is read — <span className="mono">developer.sandbox_required</span>, inside{' '}
            <span className="mono">{READ_BY_CODE['developer.sandbox_required']}</span>. Every other key this build
            declares is read by nothing:
          </p>
          <ul className="list">
            {INERT_NOTES.map((entry) => (
              <li className="list-item" key={entry.key}>
                <div>
                  <p className="list-item-title">
                    <span className="mono">{entry.key}</span> <Badge tone="outline">read by nothing</Badge>
                  </p>
                  <p className="list-item-subtitle">{entry.note}</p>
                </div>
              </li>
            ))}
          </ul>
          <p className="section-sub">
            A key this build does not declare is not listed anywhere in the repository either: treat it as inert until a
            migration or a service starts to read it.
          </p>
        </Disclosure>

        {!canManage && (
          <p className="is-locked">
            Read-only: values are visible, no control is offered, because this account lacks
            platform:manage_settings.
          </p>
        )}

        <p className="section-sub">
          <span className="mono">{ENVIRONMENT_SETTING_KEY}</span> is declared by no migration and cannot be created here
          either, so the environment marker on the developer screen falls back to the build and reads &ldquo;Not
          configured&rdquo;.
        </p>
      </section>

      {/* ── Settings by category ────────────────────────────────────── */}
      {error && (
        <div className="callout callout-danger" role="alert">
          <div>
            <p className="callout-title">Platform settings could not be loaded</p>
            <p className="callout-text">{error}</p>
          </div>
        </div>
      )}

      {grouped.map((group) => (
        <section className="card" key={group.id} aria-labelledby={`settings-${group.id}`}>
          <SectionHead id={`settings-${group.id}`} title={group.title} />

          {loading && settings.length === 0 ? (
            <SectionState loading onRetry={load}>
              {null}
            </SectionState>
          ) : group.entries.length === 0 ? (
            <p className="section-sub">No settings are stored in this group.</p>
          ) : (
            group.entries.map((entry) => {
              const label = CATEGORY_LABEL[entry.category];
              return (
                <div key={entry.category}>
                  <h3 className="section-title">{label ?? entry.category}</h3>
                  {!label && <p className="section-sub">This category is not described in this build.</p>}

                  <ul className="list">
                    {entry.rows.map((setting) => {
                      const readBy = READ_BY_CODE[setting.key];
                      const value = setting.value;
                      const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
                      const busyRow = savingKey === setting.key;
                      const rowError = rowErrors[setting.key];

                      return (
                        <li className="list-item" key={setting.key}>
                          <div className="plat-setting-main">
                            <p className="list-item-title">
                              <span className="mono">{setting.key}</span>{' '}
                              {readBy ? (
                                <Badge tone="info">read by code</Badge>
                              ) : (
                                <Badge tone="outline">read by nothing</Badge>
                              )}
                            </p>
                            <p className="list-item-subtitle">
                              {setting.description ?? 'No description recorded for this setting.'}
                            </p>
                            {readBy && (
                              <p className="list-item-subtitle">
                                Fails closed: anything other than true refuses every override, and so does the absence of
                                the row.
                              </p>
                            )}
                            <p className="list-item-subtitle">
                              Last updated {formatDateTime(setting.updatedAt)}
                              {setting.updatedAt ? ` (${formatRelative(setting.updatedAt)})` : ''}
                            </p>
                            {isObject && (
                              <p className="list-item-subtitle">
                                Only options the stored object already defines can be changed; a new one needs a
                                migration.
                              </p>
                            )}

                            {rowError && (
                              <p className="form-error" role="alert">
                                {rowError}
                              </p>
                            )}
                          </div>

                          <div className="plat-setting-edit">
                            {isObject ? (
                              // One control per key the stored object already defines.
                              // A new option has to arrive by migration, because the
                              // server refuses a key the stored object does not define.
                              Object.keys(value as Record<string, unknown>).map((objectKey) => (
                                <div className="plat-field" key={objectKey}>
                                  <ValueControl
                                    id={`setting-${setting.key}-${objectKey}`}
                                    label={objectKey}
                                    sample={(value as Record<string, unknown>)[objectKey]}
                                    value={
                                      drafts[`${setting.key}::${objectKey}`] ??
                                      controlValue((value as Record<string, unknown>)[objectKey])
                                    }
                                    disabled={!canManage || busyRow}
                                    onChange={(next) =>
                                      setDrafts((current) => ({
                                        ...current,
                                        [`${setting.key}::${objectKey}`]: next,
                                      }))
                                    }
                                  />
                                </div>
                              ))
                            ) : (
                              <ValueControl
                                id={`setting-${setting.key}`}
                                label={setting.key}
                                sample={value}
                                value={drafts[setting.key] ?? controlValue(value)}
                                disabled={!canManage || busyRow}
                                hideLabel
                                onChange={(next) =>
                                  setDrafts((current) => ({ ...current, [setting.key]: next }))
                                }
                              />
                            )}

                            {canManage ? (
                              <Button
                                className="btn-sm"
                                loading={busyRow}
                                disabled={!isDirty(setting) || busyRow}
                                onClick={() => void saveSetting(setting)}
                              >
                                Save
                              </Button>
                            ) : (
                              <span className="is-locked">Needs platform:manage_settings</span>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })
          )}
        </section>
      ))}

      {/* ── Notification templates ──────────────────────────────────── */}
      <section className="card" aria-labelledby="settings-templates">
        <SectionHead
          id="settings-templates"
          title="Notification templates"
          sub="Stored message content. No application sender reads it."
          actions={
            <Button
              variant="outline"
              className="btn-sm"
              disabled={!canManage}
              onClick={() =>
                setTemplateDraft({
                  existingKey: null,
                  key: '',
                  name: '',
                  channel: 'email',
                  subject: '',
                  body: '',
                  status: 'active',
                })
              }
            >
              New template
            </Button>
          }
        />

        <div className="callout callout-warning">
          <div>
            <p className="callout-title">No template is sent, and none is seeded</p>
            <p className="callout-text">
              A template saved here is stored, recorded in the audit trail, and never delivered. Treat this as content
              preparation, not as message configuration.
            </p>
            <Disclosure summary="Why nothing sends these">
              <p>
                The <span className="mono">notification_templates</span> table is created by migration 066 and no migration
                inserts a row into it, so a fresh database genuinely has none. No email or SMS <em>sender</em> exists
                anywhere in this application either: the only Edge Functions are the payment and logout ones. The single
                email the application can trigger is Supabase Auth&rsquo;s own verification resend (
                <span className="mono">src/services/auth.service.ts</span>), which is not an application sender and cannot
                read these templates.
              </p>
            </Disclosure>
          </div>
        </div>

        <SectionState
          loading={loading && templates.length === 0 && !templateError}
          error={templateError}
          empty={templates.length === 0}
          emptyTitle="No notification templates"
          emptyBody="No rows. Anything created here is stored and never sent."
          onRetry={load}
        >
          <DataTable
            columns={templateColumns}
            rows={templates}
            rowKey={(row) => row.id}
            caption="Notification templates"
            stacked
          />
        </SectionState>
      </section>

      {/* ── Missing ─────────────────────────────────────────────────── */}
      <section className="card" aria-labelledby="settings-missing">
        <SectionHead id="settings-missing" title="Not built for settings" />
        <ul className="list">
          {[
            'No history: the previous value survives only in the PLATFORM_SETTING_UPDATED audit row.',
            'No delete: no endpoint removes a setting or a template, so a declared key is permanent.',
            'No per-product or per-org overrides: platform_settings is one key to one value.',
            'No secrets management, deliberately: the server refuses credential-shaped keys and values.',
            'No preview or dry run: a change takes effect immediately, today for a single key.',
          ].map((item) => (
            <li className="list-item" key={item}>
              <div>
                <p className="list-item-title">
                  <StatusBadge status="not_configured" /> <Badge tone="outline">no endpoint</Badge>
                </p>
                <p className="list-item-subtitle">{item}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* ── Template dialog ─────────────────────────────────────────── */}
      <Dialog
        open={templateDraft !== null}
        onClose={() => setTemplateDraft(null)}
        title={templateDraft?.existingKey ? `Edit ${templateDraft.existingKey}` : 'New notification template'}
        description="Saved to notification_templates, where nothing reads it."
        footer={
          <>
            <Button variant="outline" onClick={() => setTemplateDraft(null)} disabled={savingTemplate}>
              Cancel
            </Button>
            <Button onClick={() => void saveTemplate()} loading={savingTemplate}>
              Save template
            </Button>
          </>
        }
      >
        {templateDraft && (
          <>
            <div className="callout callout-warning">
              <div>
                <p className="callout-title">Stored, never sent</p>
                <p className="callout-text">
                  The one message this application can trigger — Supabase Auth&rsquo;s verification resend — does not read
                  this table, and the body is deliberately kept out of the audit trail.
                </p>
              </div>
            </div>

            <label className="form-label" htmlFor="template-key">
              Key
            </label>
            <input
              id="template-key"
              className="form-input mono"
              value={templateDraft.key}
              // The RPC upserts on the key, so editing one here would insert a
              // second template instead of renaming this one.
              disabled={templateDraft.existingKey !== null || savingTemplate}
              onChange={(event) => setTemplateDraft({ ...templateDraft, key: event.target.value })}
            />
            {templateDraft.existingKey !== null && (
              <p className="form-hint">The key cannot be changed: the save is an upsert keyed on it.</p>
            )}

            <label className="form-label" htmlFor="template-name">
              Name
            </label>
            <input
              id="template-name"
              className="form-input"
              value={templateDraft.name}
              disabled={savingTemplate}
              onChange={(event) => setTemplateDraft({ ...templateDraft, name: event.target.value })}
            />

            <label className="form-label" htmlFor="template-channel">
              Channel
            </label>
            <select
              id="template-channel"
              className="select-input"
              value={templateDraft.channel}
              disabled={savingTemplate}
              onChange={(event) => setTemplateDraft({ ...templateDraft, channel: event.target.value })}
            >
              {TEMPLATE_CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {channel.replace(/_/g, ' ')}
                </option>
              ))}
            </select>

            <label className="form-label" htmlFor="template-subject">
              Subject (optional)
            </label>
            <input
              id="template-subject"
              className="form-input"
              value={templateDraft.subject}
              disabled={savingTemplate}
              onChange={(event) => setTemplateDraft({ ...templateDraft, subject: event.target.value })}
            />

            <label className="form-label" htmlFor="template-body">
              Body
            </label>
            <textarea
              id="template-body"
              // Deliberately not .form-input: that class pins height and horizontal
              // padding for single-line controls, while waya.css styles a bare
              // textarea with min-height and vertical resize.
              rows={6}
              value={templateDraft.body}
              disabled={savingTemplate}
              onChange={(event) => setTemplateDraft({ ...templateDraft, body: event.target.value })}
            />

            <label className="form-label" htmlFor="template-status">
              Status
            </label>
            <select
              id="template-status"
              className="select-input"
              value={templateDraft.status}
              disabled={savingTemplate}
              onChange={(event) => setTemplateDraft({ ...templateDraft, status: event.target.value })}
            >
              <option value="active">active</option>
              <option value="inactive">inactive</option>
            </select>

            {templateFormError && (
              <p className="form-error" role="alert">
                {templateFormError}
              </p>
            )}
          </>
        )}
      </Dialog>
    </>
  );
}
