import { useSearchParams } from 'react-router-dom';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import {
  JOB_STATUS_FLOW,
  JOB_STATUS_LABEL,
  JobService,
  type JobStatus,
  type JobSummary,
  type TailoringJob,
} from '../../services/job.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import { useToast } from '../../components/ui/Toast';
import { Card, Empty, Page, PageHeader, Pill, Stat, btn, cn, inputClass } from '../../components/kit';

function formatMoney(value: number): string {
  return `₦${value
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

const STATUS_TONE: Record<JobStatus, 'neutral' | 'brand' | 'warn' | 'success' | 'danger'> = {
  received: 'neutral',
  in_progress: 'brand',
  ready_for_fitting: 'warn',
  alterations: 'warn',
  ready_for_pickup: 'success',
  delivered: 'success',
  cancelled: 'danger',
};

/** Board filters: each groups the statuses a tailor thinks of together. */
const BOARD_FILTERS: Array<{ key: string; label: string; statuses: JobStatus[] | null }> = [
  { key: 'all', label: 'All', statuses: null },
  { key: 'making', label: 'Being made', statuses: ['received', 'in_progress'] },
  { key: 'fitting', label: 'Fitting', statuses: ['ready_for_fitting', 'alterations'] },
  { key: 'pickup', label: 'Ready for pickup', statuses: ['ready_for_pickup'] },
];

function dueLabel(job: TailoringJob): { text: string; tone: string } | null {
  if (!job.dueDate || job.daysUntilDue === null) return null;
  if (job.daysUntilDue < 0) return { text: `Overdue by ${Math.abs(job.daysUntilDue)}d`, tone: 'text-danger' };
  if (job.daysUntilDue === 0) return { text: 'Due today', tone: 'text-warn-ink' };
  if (job.daysUntilDue === 1) return { text: 'Due tomorrow', tone: 'text-warn-ink' };
  return { text: `Due in ${job.daysUntilDue}d`, tone: job.daysUntilDue <= 3 ? 'text-warn-ink' : 'text-ink-3' };
}

const MEASUREMENT_FIELDS = ['chest', 'waist', 'hip', 'length'] as const;

export default function JobsPage() {
  const toast = useToast();
  const [search, setSearch] = useSearchParams();
  const { profile } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const storeId = profile?.currentStoreId;

  const canCreate = hasPermission('job:create');
  const canUpdate = hasPermission('job:update');

  const [jobs, setJobs] = useState<TailoringJob[]>([]);
  const [summary, setSummary] = useState<JobSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  useEffect(() => {
    if (!permsLoading && canCreate && search.get('new') === '1') {
      setShowForm(true);
      setSearch(previous => { const next = new URLSearchParams(previous); next.delete('new'); return next; }, { replace: true });
    }
  }, [permsLoading, canCreate, search, setSearch]);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [boardFilter, setBoardFilter] = useState('all');

  const [measurements, setMeasurements] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    garmentType: '',
    customerName: '',
    customerPhone: '',
    quantity: '1',
    price: '',
    deposit: '',
    dueDate: '',
    fabricSuppliedBy: 'business',
    designNotes: '',
  });

  const load = useCallback(() => {
    if (!storeId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([JobService.list(storeId), JobService.summary(storeId)])
      .then(([rows, summaryRow]) => {
        setJobs(rows);
        setSummary(summaryRow);
      })
      .catch((err) => setError(err?.message ?? 'Could not load jobs'))
      .finally(() => setLoading(false));
  }, [storeId]);

  useEffect(load, [load]);

  const create = async () => {
    if (!storeId) return;
    setSaving(true);
    setError(null);
    const toastId = toast.loading('Creating job…', { dedupeKey: 'job-create' });
    try {
      const filled = Object.fromEntries(
        Object.entries(measurements).filter(([, v]) => v.trim() !== '')
      );
      await JobService.create({
        storeId,
        garmentType: form.garmentType,
        customerName: form.customerName || null,
        customerPhone: form.customerPhone || null,
        quantity: Number(form.quantity) || 1,
        price: Number(form.price) || 0,
        deposit: Number(form.deposit) || 0,
        dueDate: form.dueDate || null,
        fabricSuppliedBy: form.fabricSuppliedBy as 'business' | 'client',
        designNotes: form.designNotes || null,
        measurements: Object.keys(filled).length > 0 ? filled : null,
      });
      toast.update(toastId, { variant: 'success', message: `Job created for ${form.garmentType}` });
      setForm({
        garmentType: '',
        customerName: '',
        customerPhone: '',
        quantity: '1',
        price: '',
        deposit: '',
        dueDate: '',
        fabricSuppliedBy: 'business',
        designNotes: '',
      });
      setMeasurements({});
      setShowForm(false);
      load();
    } catch (err) {
      const message = (err as Error)?.message ?? 'Could not create the job';
      setError(message);
      toast.update(toastId, { variant: 'error', message: 'Job was not created', description: message });
    } finally {
      setSaving(false);
    }
  };

  const advance = async (job: TailoringJob, status: JobStatus, why?: string) => {
    setSaving(true);
    setError(null);
    const toastId = toast.loading(`Updating job #${job.jobNumber}…`, { dedupeKey: `job-${job.id}` });
    try {
      await JobService.setStatus(job.id, status, why);
      toast.update(toastId, { variant: 'success', message: `Job #${job.jobNumber} moved to ${JOB_STATUS_LABEL[status].toLowerCase()}` });
      setReasonFor(null);
      setReason('');
      load();
    } catch (err) {
      // The database refuses illegal and unexplained moves; show its message.
      const message = (err as Error)?.message ?? 'Could not update the job';
      setError(message);
      toast.update(toastId, { variant: 'error', message: 'Job was not updated', description: message });
    } finally {
      setSaving(false);
    }
  };

  const pay = async (job: TailoringJob) => {
    setSaving(true);
    setError(null);
    const toastId = toast.loading(`Recording payment for job #${job.jobNumber}…`, { dedupeKey: `job-payment-${job.id}` });
    try {
      await JobService.recordPayment(job.id, Number(payAmount));
      toast.update(toastId, { variant: 'success', message: `Payment recorded for job #${job.jobNumber}` });
      setPayingId(null);
      setPayAmount('');
      load();
    } catch (err) {
      const message = (err as Error)?.message ?? 'Could not record the payment';
      setError(message);
      toast.update(toastId, { variant: 'error', message: 'Payment was not recorded', description: message });
    } finally {
      setSaving(false);
    }
  };

  if (loading || permsLoading) return <PageLoader />;

  // The next step on the normal path; the database holds the real rules.
  const nextStatus = (job: TailoringJob): JobStatus | null => {
    const index = JOB_STATUS_FLOW.indexOf(job.status);
    if (index < 0 || index >= JOB_STATUS_FLOW.length - 1) return null;
    return JOB_STATUS_FLOW[index + 1];
  };

  const label = 'mb-1.5 block text-[13px] font-medium text-ink-2';
  const filter = BOARD_FILTERS.find((f) => f.key === boardFilter) ?? BOARD_FILTERS[0];
  const shown = filter.statuses ? jobs.filter((job) => filter.statuses!.includes(job.status)) : jobs;
  const countFor = (statuses: JobStatus[] | null) => (statuses ? jobs.filter((job) => statuses.includes(job.status)).length : jobs.length);

  return (
    <Page>
      <PageHeader
        title="Jobs"
        subtitle="What is being made, for whom, and what is still owed"
        actions={canCreate && (
          <Button variant={showForm ? 'outline' : 'primary'} onClick={() => setShowForm((open) => !open)} aria-expanded={showForm}>
            {showForm ? 'Cancel' : 'New job'}
          </Button>
        )}
      />

      {error && <div className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</div>}

      {summary && (
        <section className="mb-4 grid grid-cols-2 gap-3 lg:mb-6 lg:grid-cols-4 lg:gap-4" aria-label="Jobs summary">
          <Stat label="Due this week" value={summary.jobsDueSoon} />
          <Stat label="Overdue" value={summary.jobsOverdue} tone={summary.jobsOverdue > 0 ? 'danger' : undefined} />
          <Stat label="Ready for pickup" value={summary.awaitingPickup} tone={summary.awaitingPickup > 0 ? 'success' : undefined} />
          <Stat label="Outstanding balances" value={formatMoney(summary.outstandingBalances)} tone={summary.outstandingBalances > 0 ? 'warn' : undefined} />
        </section>
      )}

      {showForm && canCreate && (
        <form
          className="mb-4 lg:mb-6"
          aria-labelledby="job-form-title"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <Card className="border-brand-line">
            <div className="mb-4">
              <h2 id="job-form-title" className="m-0 text-[15px] font-semibold text-ink">Create a job</h2>
              <p className="m-0 mt-0.5 text-[13px] text-ink-3">Who it is for, what you agreed, and their measurements.</p>
            </div>
            <div className="grid gap-x-4 md:grid-cols-3">
              <div className="md:col-span-3">
                <FormField
                  id="job-garment"
                  label="What is being made?"
                  value={form.garmentType}
                  onChange={(v) => setForm({ ...form, garmentType: v })}
                  placeholder="e.g. Agbada, aso-ebi gown"
                  required
                />
              </div>
              <FormField
                id="job-client"
                label="Client"
                value={form.customerName}
                onChange={(v) => setForm({ ...form, customerName: v })}
              />
              <FormField
                id="job-phone"
                label="Phone"
                type="tel"
                inputMode="tel"
                value={form.customerPhone}
                onChange={(v) => setForm({ ...form, customerPhone: v })}
              />
              <FormField
                id="job-due"
                label="Due date"
                type="date"
                value={form.dueDate}
                onChange={(v) => setForm({ ...form, dueDate: v })}
              />
              <FormField
                id="job-price" type="number" min={0} step="0.01" inputMode="decimal"
                label="Agreed price (NGN)"
                value={form.price}
                onChange={(v) => setForm({ ...form, price: v })}
              />
              <FormField
                id="job-deposit" type="number" min={0} step="0.01" inputMode="decimal"
                label="Deposit taken (NGN)"
                value={form.deposit}
                onChange={(v) => setForm({ ...form, deposit: v })}
                error={Number(form.deposit) > Number(form.price || 0) ? 'Deposit cannot be more than the price' : undefined}
              />
              <div className="mb-4">
                <label className={label} htmlFor="job-fabric">Fabric supplied by</label>
                <select
                  id="job-fabric"
                  className={inputClass}
                  value={form.fabricSuppliedBy}
                  onChange={(e) => setForm({ ...form, fabricSuppliedBy: e.target.value })}
                >
                  <option value="business">Us</option>
                  <option value="client">The client</option>
                </select>
              </div>
            </div>

            {/* Measurements are copied onto the job, so later edits cannot rewrite them. */}
            <fieldset className="m-0 mb-1 min-w-0 rounded-lg border-0 bg-subtle p-4 pb-0">
              <legend className="float-left mb-3 w-full p-0 text-[13px] font-semibold text-ink">Measurements (inches)</legend>
              <div className="clear-left grid grid-cols-2 gap-x-3 sm:grid-cols-4">
                {MEASUREMENT_FIELDS.map((field) => (
                  <FormField
                    key={field}
                    id={`measure-${field}`}
                    label={field.charAt(0).toUpperCase() + field.slice(1)}
                    inputMode="decimal"
                    value={measurements[field] ?? ''}
                    onChange={(v) => setMeasurements({ ...measurements, [field]: v })}
                  />
                ))}
              </div>
            </fieldset>

            <div className="mt-4">
              <FormField
                id="job-notes"
                label="Design notes"
                value={form.designNotes}
                onChange={(v) => setForm({ ...form, designNotes: v })}
                placeholder="Style, colours, embroidery…"
              />
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Not now</Button>
              <Button
                type="submit"
                loading={saving}
                disabled={!form.garmentType.trim() || Number(form.deposit) > Number(form.price || 0)}
              >
                Create job
              </Button>
            </div>
          </Card>
        </form>
      )}

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="m-0 px-1 text-[15px] font-semibold text-ink">
          {jobs.length} open job{jobs.length === 1 ? '' : 's'}
        </h2>
        {jobs.length > 0 && (
          <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <div className="inline-flex shrink-0 rounded-lg bg-tray p-1" role="group" aria-label="Show jobs">
              {BOARD_FILTERS.map((f) => (
                <button key={f.key} type="button" aria-pressed={boardFilter === f.key}
                  className={cn('h-8 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors',
                    boardFilter === f.key ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink')}
                  onClick={() => setBoardFilter(f.key)}>
                  {f.label} <span className="tabular-nums text-ink-3">{countFor(f.statuses)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {jobs.length === 0 ? (
        <Empty
          title="No tailoring jobs yet"
          body="Add a client and record their measurements to get started."
          action={canCreate ? <Button className="btn-sm" onClick={() => setShowForm(true)}>New job</Button> : undefined}
        />
      ) : shown.length === 0 ? (
        <Empty title={`Nothing ${filter.label.toLowerCase()} right now`} body="Choose another filter to see the rest of the board." />
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0 md:grid-cols-2 lg:gap-4 xl:grid-cols-3">
          {shown.map((job) => {
            const next = nextStatus(job);
            const due = dueLabel(job);
            const paidShare = job.price > 0 ? Math.min(job.paid / job.price, 1) : 1;
            const open = job.status !== 'delivered' && job.status !== 'cancelled';
            return (
              <li key={job.id} className="min-w-0">
                <Card className={cn('flex h-full flex-col', job.daysUntilDue !== null && job.daysUntilDue < 0 && open && 'border-danger/40')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="m-0 text-xs font-medium tabular-nums text-ink-3">#{job.jobNumber}</p>
                      <h3 className="m-0 mt-0.5 truncate text-[15px] font-semibold text-ink">
                        {job.garmentType}
                        {job.quantity > 1 ? <span className="font-normal text-ink-2"> × {job.quantity}</span> : ''}
                      </h3>
                      <p className="m-0 mt-0.5 truncate text-[13px] text-ink-2">{job.customerName ?? 'No client named'}</p>
                    </div>
                    <Pill tone={STATUS_TONE[job.status] ?? 'neutral'}>{JOB_STATUS_LABEL[job.status]}</Pill>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    {due && <span className={cn('font-medium', due.tone)}>{due.text}</span>}
                    {job.nextFittingAt && <span className="text-ink-3">Fitting scheduled</span>}
                  </div>

                  <div className="mt-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-tray" aria-hidden="true">
                      <span className={cn('block h-full rounded-full', job.balance > 0 ? 'bg-brand' : 'bg-success')} style={{ width: `${Math.round(paidShare * 100)}%` }} />
                    </div>
                    <p className="m-0 mt-1.5 flex flex-wrap justify-between gap-x-3 text-xs tabular-nums text-ink-3">
                      <span>{formatMoney(job.paid)} paid of {formatMoney(job.price)}</span>
                      {job.balance > 0
                        ? <strong className="font-semibold text-warn-ink">{formatMoney(job.balance)} owed</strong>
                        : <span className="font-medium text-success-ink">Paid in full</span>}
                    </p>
                  </div>

                  {(canUpdate && open) || (canCreate && job.balance > 0) ? (
                    <div className="mt-auto pt-4">
                    <div className="grid grid-cols-2 gap-2 border-t border-line pt-3">
                      {next && canUpdate && (
                        <button type="button" className={cn(btn('soft', 'sm'), 'h-9', !(canCreate && job.balance > 0) && 'col-span-2')} disabled={saving} aria-busy={saving || undefined}
                          onClick={() => advance(job, next)}>
                          {JOB_STATUS_LABEL[next]}
                        </button>
                      )}
                      {canCreate && job.balance > 0 && (
                        <Button variant="outline" className={cn('btn-sm h-9', !(next && canUpdate) && 'col-span-2')} onClick={() => { setPayingId(job.id); setReasonFor(null); }}>
                          Take payment
                        </Button>
                      )}
                      {canUpdate && open && (
                        <select
                          className="col-span-2 block h-9 w-full min-w-0 rounded-md border border-line bg-surface px-3 text-[13px] text-ink-2 hover:bg-hover focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 disabled:opacity-50"
                          value=""
                          disabled={saving}
                          aria-label={`Move job ${job.jobNumber}`}
                          onChange={(e) => {
                            const chosen = e.target.value as JobStatus;
                            if (!chosen) return;
                            // Backward moves need a reason, so collect it before calling.
                            if (JOB_STATUS_FLOW.indexOf(chosen) < JOB_STATUS_FLOW.indexOf(job.status)) {
                              setReasonFor(job.id);
                              setPayingId(null);
                              setReason('');
                              setForm((f) => ({ ...f, designNotes: f.designNotes }));
                            } else {
                              advance(job, chosen);
                            }
                          }}
                        >
                          <option value="">Move to…</option>
                          {JOB_STATUS_FLOW.filter((s) => s !== job.status).map((s) => (
                            <option key={s} value={s}>
                              {JOB_STATUS_LABEL[s]}
                            </option>
                          ))}
                          <option value="cancelled">Cancel job</option>
                        </select>
                      )}
                    </div>
                    </div>
                  ) : null}

                  {reasonFor === job.id && (
                    <div className="mt-3 rounded-lg bg-subtle p-3">
                      <FormField
                        id={`reason-${job.id}`}
                        label="Why is this job going back a step?"
                        value={reason}
                        onChange={setReason}
                      />
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          className="btn-sm"
                          disabled={reason.trim().length < 3}
                          onClick={() => {
                            const index = JOB_STATUS_FLOW.indexOf(job.status);
                            const back = JOB_STATUS_FLOW[Math.max(index - 1, 0)];
                            advance(job, back, reason);
                          }}
                        >
                          Confirm
                        </Button>
                        <Button variant="ghost" className="btn-sm" onClick={() => setReasonFor(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}

                  {payingId === job.id && (
                    <div className="mt-3 rounded-lg bg-subtle p-3">
                      <FormField
                        id={`pay-${job.id}`}
                        label={`Amount (${formatMoney(job.balance)} outstanding)`}
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        value={payAmount}
                        onChange={setPayAmount}
                      />
                      <div className="flex gap-2">
                        <Button
                          className="btn-sm"
                          loading={saving}
                          disabled={!payAmount || Number(payAmount) <= 0}
                          onClick={() => pay(job)}
                        >
                          Record payment
                        </Button>
                        <Button variant="ghost" className="btn-sm" onClick={() => setPayingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </Page>
  );
}
