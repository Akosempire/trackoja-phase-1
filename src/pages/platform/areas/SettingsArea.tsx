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
 * What each setting actually does, and what reads it.
 *
 * Verified by reading the migrations rather than inferred from the key name:
 * `developer.sandbox_required` is the only seeded key any code reads (it is the
 * guard inside assert_sandbox_override() in
 * 20260926000072_platform_developer_mode_functions.sql), and the rest are written
 * and returned but never consulted. A control that silently does nothing is worse
 * than no control, so each row says which it is.
 */
const SETTING_TRUTH: Record<string, { readBy: string | null; note: string }> = {
  'developer.sandbox_required': {
    readBy: 'assert_sandbox_override(), 20260926000072_platform_developer_mode_functions.sql',
    note: 'The only seeded setting any code reads. It fails closed: anything other than true refuses every developer-mode override, and the absence of the row does too.',
  },
  'billing.trial_days': {
    readBy: null,
    note: 'Stored and editable, but nothing reads it. Trial length actually comes from a plan entitlement’s own metadata, not from this key, so changing it has no effect today.',
  },
  'billing.annual_months_free': {
    readBy: null,
    note: 'Stored and editable, but nothing reads it: no code computes an annual price from this value, so changing it has no effect today.',
  },
  'billing.currency': {
    readBy: null,
    note: 'Stored and editable, but nothing reads it: plans carry their own currency column, which is what billing uses.',
  },
  'products.trackoja.visible': {
    readBy: null,
    note: 'Stored and editable, but nothing reads it, and it duplicates platform_products.visibility for the same product — two sources of truth for one question.',
  },
  'products.trackoja_works.visible': {
    readBy: null,
    note: 'Stored and editable, but nothing reads it, and it duplicates platform_products.visibility for the same product.',
  },
  'activation.keys_enabled': {
    readBy: null,
    note: 'Stored and editable, but nothing reads it. Issuing and redeeming activation keys is not gated on this key, so turning it off does not disable keys.',
  },
  'products.trackoja.tiers_public': {
    readBy: null,
    note: 'Stored and editable, but nothing reads it. Which tiers are advertised actually comes from product_plans.is_public, so editing this list changes nothing.',
  },
};

const TRUTH_FALLBACK = {
  readBy: null,
  note: 'Not a key this build declares. Nothing in this repository reads it, so treat it as inert until a migration or a service starts to.',
};

/**
 * Categories are grouped into what changes platform behaviour and what is
 * content, because the two carry very different expectations about taking effect.
 */
const GROUPS: { id: string; title: string; sub: string; categories: string[] }[] = [
  {
    id: 'operational',
    title: 'Operational configuration',
    sub: 'Configuration the platform behaves according to — where any code reads it at all. Each row below states what reads it, and most of these are read by nothing.',
    categories: ['payments', 'activation', 'developer', 'notifications', 'general'],
  },
  {
    id: 'branding',
    title: 'Branding and content',
    sub: 'What is advertised publicly. These are stored values only: the storefront and the signup flow read neither of them today, and products.*.visible duplicates the visibility column on the product row itself.',
    categories: ['products'],
  },
];

const CATEGORY_LABEL: Record<string, { label: string; sub: string }> = {
  payments: {
    label: 'Billing and payments',
    sub: 'Defaults the billing flow is meant to use. They are stored, but each one is read by nothing — see the note on each row.',
  },
  activation: {
    label: 'Activation keys',
    sub: 'Whether offline or manually approved purchases can be activated with a key.',
  },
  developer: {
    label: 'Developer mode',
    sub: 'The guard that constrains what developer-mode overrides are allowed to touch.',
  },
  notifications: {
    label: 'Notifications',
    sub: 'Reserved for notification configuration. No seeded setting uses this category.',
  },
  general: {
    label: 'General',
    sub: 'Reserved for general platform configuration. No seeded setting uses this category.',
  },
  products: {
    label: 'Product visibility',
    sub: 'Which products and tiers are advertised. Setting a value here does not change the catalogue: platform_products.visibility and product_plans.is_public are what the dashboard and the catalogue actually use.',
  },
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
      toast.success(`${setting.key} saved`, {
        description: 'The previous value was replaced and the change was written to the audit trail.',
      });
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
              sub: 'Settings whose category this screen does not know, shown so nothing in the table is invisible.',
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
        description: 'Stored only. No application sender reads notification templates.',
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
            ? 'Platform configuration and notification content. Only existing settings can be changed: the server refuses new keys, new object keys and anything that looks like a credential.'
            : 'Platform configuration and notification content, read-only because this account does not hold platform:manage_settings.'
        }
        actions={<RefreshButton onClick={load} loading={loading} />}
      />

      <AreaCoverage gaps={AREA.gaps} title="What this screen cannot do" />

      {/* ── How these settings behave ───────────────────────────────── */}
      <section className="card" aria-labelledby="settings-rules">
        <SectionHead
          id="settings-rules"
          title="How these settings behave"
          sub="Written to match set_platform_setting() rather than to look tidy."
        />

        <div className="callout callout-info">
          <div>
            <p className="callout-title">The server decides what may be written</p>
            <p className="callout-text">
              <span className="mono">set_platform_setting()</span> (rewritten in{' '}
              <span className="mono">20260927000089_platform_owner_hardening.sql</span>, section 7.5) cannot create a
              setting: an unknown key is refused outright. It cannot add a key to an object value, because the
              replacement must not define a key the stored value does not. It refuses a value whose JSON type differs from
              the stored one, and it refuses any key or value matching{' '}
              <span className="mono">secret|password|token|api_key|private_key|service_role</span>. That last rule is
              deliberate: credentials belong in server-side secret storage, so this screen never offers a field for them.
              Where a save is refused, the server&rsquo;s own message is shown on the row.
            </p>
          </div>
        </div>

        {!canManage && (
          <p className="is-locked">
            Read-only: every value below is visible, and no control is offered, because this account lacks
            platform:manage_settings.
          </p>
        )}

        <p className="section-sub">
          One setting is missing rather than forgotten: <span className="mono">{ENVIRONMENT_SETTING_KEY}</span>, which the
          environment marker on the developer screen reads, is declared by no migration — and because this function
          refuses unknown keys, it cannot be created here either. Until a migration declares it, that marker falls back to
          the build.
        </p>

        <p className="section-sub">
          Most of what is seeded is inert, and each row says so. A stored value that no code reads is indistinguishable
          from a working control, so marking them is the only honest option.
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
          <SectionHead id={`settings-${group.id}`} title={group.title} sub={group.sub} />

          {loading && settings.length === 0 ? (
            <SectionState loading onRetry={load}>
              {null}
            </SectionState>
          ) : group.entries.length === 0 ? (
            <p className="section-sub">No settings are stored in this group.</p>
          ) : (
            group.entries.map((entry) => {
              const label = CATEGORY_LABEL[entry.category] ?? {
                label: entry.category,
                sub: 'No description of this category is available in this build.',
              };
              return (
                <div key={entry.category}>
                  <h3 className="section-title">{label.label}</h3>
                  <p className="section-sub">{label.sub}</p>

                  <ul className="list">
                    {entry.rows.map((setting) => {
                      const truth = SETTING_TRUTH[setting.key] ?? TRUTH_FALLBACK;
                      const value = setting.value;
                      const isObject = value !== null && typeof value === 'object' && !Array.isArray(value);
                      const busyRow = savingKey === setting.key;
                      const rowError = rowErrors[setting.key];

                      return (
                        <li className="list-item" key={setting.key}>
                          <div className="plat-setting-main">
                            <p className="list-item-title">
                              <span className="mono">{setting.key}</span>{' '}
                              {truth.readBy ? (
                                <Badge tone="info">read by code</Badge>
                              ) : (
                                <Badge tone="outline">read by nothing</Badge>
                              )}
                            </p>
                            <p className="list-item-subtitle">
                              {setting.description ?? 'No description recorded for this setting.'}
                            </p>
                            <p className="list-item-subtitle">
                              {truth.readBy ? `Read by ${truth.readBy}. ` : ''}
                              {truth.note}
                            </p>
                            <p className="list-item-subtitle">
                              Last updated {formatDateTime(setting.updatedAt)}
                              {setting.updatedAt ? ` (${formatRelative(setting.updatedAt)})` : ''}
                            </p>
                            {isObject && (
                              <p className="list-item-subtitle">
                                Only the options already stored can be changed: the server refuses a key the saved object
                                does not define, so a new option has to be added by migration first.
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
              The <span className="mono">notification_templates</span> table is created by{' '}
              <span className="mono">20260926000066_platform_operations_schema.sql</span> and no migration inserts a row
              into it, so a fresh database genuinely has none. No email or SMS <em>sender</em> exists anywhere in this
              application either — the only Edge Functions are the payment and logout ones, and none of them sends a
              message. The single email the application can trigger at all is Supabase Auth&rsquo;s own verification
              resend (<span className="mono">src/services/auth.service.ts</span>), which is not an application sender and
              cannot read these templates. So a template saved here is stored, recorded in the audit trail, and never
              delivered: treat this as content preparation, not as message configuration.
            </p>
          </div>
        </div>

        <SectionState
          loading={loading && templates.length === 0 && !templateError}
          error={templateError}
          empty={templates.length === 0}
          emptyTitle="No notification templates"
          emptyBody="The table has no rows. Create one to prepare message content, knowing that nothing will send it."
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
        <SectionHead
          id="settings-missing"
          title="Not built for settings"
          sub="Stated here because each absence changes how much a saved value can be trusted."
        />
        <ul className="list">
          {[
            'No settings history in the table: set_platform_setting() overwrites the previous value and records only updated_by and updated_at on the row. The previous value is captured in the PLATFORM_SETTING_UPDATED audit row instead, so history exists only in the audit trail and only for changes made after migration 089.',
            'No delete: no endpoint removes a setting or a template, so a key a migration once declared is permanent even when nothing reads it.',
            'No per-product or per-org overrides: platform_settings is one key to one value, so a different value for one product or one customer is not representable and would need a new table.',
            'No secrets management, deliberately: credential-shaped keys and values are refused by the server, and secrets stay in server-side storage.',
            'No settings preview or dry run: a change takes effect immediately for anything that reads the key, and today that is a single key.',
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
                  No email or SMS sender is configured anywhere in this application, so a template exists only as content
                  in this table — the one message the app can trigger, Supabase Auth&rsquo;s verification resend, does not
                  read it. The body is deliberately kept out of the audit trail; the audit row records that the template
                  changed, who changed it, and how its name, channel, subject and status moved.
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
              <p className="form-hint">
                The key cannot be changed: the save is an upsert keyed on it, so a new value would create a second
                template rather than rename this one.
              </p>
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

            <p className="form-hint">
              Channel is limited to email, sms and in_app, and status to active or inactive; both are checked by the
              table and again by the save function.
            </p>

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
