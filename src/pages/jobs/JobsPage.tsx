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

function formatMoney(value: number): string {
  return `₦${value
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

const STATUS_BADGE: Record<JobStatus, string> = {
  received: 'badge-default',
  in_progress: 'badge-warning',
  ready_for_fitting: 'badge-warning',
  alterations: 'badge-warning',
  ready_for_pickup: 'badge-success',
  delivered: 'badge-success',
  cancelled: 'badge-danger',
};

const MEASUREMENT_FIELDS = ['chest', 'waist', 'hip', 'length'] as const;

export default function JobsPage() {
  const { profile } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const storeId = profile?.currentStoreId;

  const canCreate = hasPermission('job:create');
  const canUpdate = hasPermission('job:update');

  const [jobs, setJobs] = useState<TailoringJob[]>([]);
  const [summary, setSummary] = useState<JobSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');

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
    setNotice(null);
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
      setNotice(`Job created for ${form.garmentType}`);
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
      setError((err as Error)?.message ?? 'Could not create the job');
    } finally {
      setSaving(false);
    }
  };

  const advance = async (job: TailoringJob, status: JobStatus, why?: string) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await JobService.setStatus(job.id, status, why);
      setNotice(`Job #${job.jobNumber} moved to ${JOB_STATUS_LABEL[status].toLowerCase()}`);
      setReasonFor(null);
      setReason('');
      load();
    } catch (err) {
      // The database refuses illegal and unexplained moves; show its message.
      setError((err as Error)?.message ?? 'Could not update the job');
    } finally {
      setSaving(false);
    }
  };

  const pay = async (job: TailoringJob) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await JobService.recordPayment(job.id, Number(payAmount));
      setNotice(`Payment recorded for job #${job.jobNumber}`);
      setPayingId(null);
      setPayAmount('');
      load();
    } catch (err) {
      setError((err as Error)?.message ?? 'Could not record the payment');
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

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Jobs</h1>
          <p className="page-subtitle">What is being made, for whom, and what is still owed</p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowForm((open) => !open)}>
            {showForm ? 'Cancel' : 'Create job'}
          </Button>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {notice && <div className="alert alert-success">{notice}</div>}

      {summary && (
        <div className="stats-grid">
          <div className="stat-card">
            <p className="stat-label">Due this week</p>
            <p className="stat-value">{summary.jobsDueSoon}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Overdue</p>
            <p className={`stat-value${summary.jobsOverdue > 0 ? ' dash-value-danger' : ''}`}>
              {summary.jobsOverdue}
            </p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Ready for pickup</p>
            <p className="stat-value">{summary.awaitingPickup}</p>
          </div>
          <div className="stat-card">
            <p className="stat-label">Outstanding balances</p>
            <p className="stat-value">{formatMoney(summary.outstandingBalances)}</p>
          </div>
        </div>
      )}

      {showForm && canCreate && (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <p className="list-item-title">Create a job</p>
          <FormField
            id="job-garment"
            label="What is being made?"
            value={form.garmentType}
            onChange={(v) => setForm({ ...form, garmentType: v })}
            required
          />
          <div className="auth-form-row">
            <FormField
              id="job-client"
              label="Client"
              value={form.customerName}
              onChange={(v) => setForm({ ...form, customerName: v })}
            />
            <FormField
              id="job-phone"
              label="Phone"
              value={form.customerPhone}
              onChange={(v) => setForm({ ...form, customerPhone: v })}
            />
          </div>
          <div className="auth-form-row">
            <FormField
              id="job-price"
              label="Agreed price (NGN)"
              value={form.price}
              onChange={(v) => setForm({ ...form, price: v })}
            />
            <FormField
              id="job-deposit"
              label="Deposit taken (NGN)"
              value={form.deposit}
              onChange={(v) => setForm({ ...form, deposit: v })}
            />
          </div>
          <div className="auth-form-row">
            <FormField
              id="job-due"
              label="Due date"
              type="date"
              value={form.dueDate}
              onChange={(v) => setForm({ ...form, dueDate: v })}
            />
            <label className="form-group">
              <span className="form-label">Fabric supplied by</span>
              <select
                className="select-input"
                value={form.fabricSuppliedBy}
                onChange={(e) => setForm({ ...form, fabricSuppliedBy: e.target.value })}
              >
                <option value="business">Us</option>
                <option value="client">The client</option>
              </select>
            </label>
          </div>

          {/* Measurements are copied onto the job, so later edits cannot rewrite them. */}
          <p className="form-label">Measurements (inches)</p>
          <div className="auth-form-row">
            {MEASUREMENT_FIELDS.map((field) => (
              <FormField
                key={field}
                id={`measure-${field}`}
                label={field.charAt(0).toUpperCase() + field.slice(1)}
                value={measurements[field] ?? ''}
                onChange={(v) => setMeasurements({ ...measurements, [field]: v })}
              />
            ))}
          </div>

          <FormField
            id="job-notes"
            label="Design notes"
            value={form.designNotes}
            onChange={(v) => setForm({ ...form, designNotes: v })}
          />

          <Button
            type="submit"
            loading={saving}
            disabled={!form.garmentType.trim() || Number(form.deposit) > Number(form.price || 0)}
          >
            Create job
          </Button>
        </form>
      )}

      <div className="card">
        <p className="list-item-title">
          {jobs.length} open job{jobs.length === 1 ? '' : 's'}
        </p>
        {jobs.length === 0 ? (
          <div className="empty-state">
            No jobs yet. Add a client and record their measurements to get started.
          </div>
        ) : (
          <div className="list">
            {jobs.map((job) => {
              const next = nextStatus(job);
              return (
                <div className="list-item" key={job.id}>
                  <div>
                    <p className="list-item-title">
                      #{job.jobNumber} · {job.garmentType}
                      {job.quantity > 1 ? ` × ${job.quantity}` : ''}
                    </p>
                    <p className="list-item-subtitle">
                      {job.customerName ?? 'No client named'}
                      {job.dueDate
                        ? job.daysUntilDue !== null && job.daysUntilDue < 0
                          ? ` · overdue by ${Math.abs(job.daysUntilDue)}d`
                          : ` · due in ${job.daysUntilDue}d`
                        : ''}
                    </p>
                    <p className="list-item-subtitle">
                      {formatMoney(job.price)} agreed · {formatMoney(job.paid)} paid ·{' '}
                      <strong>{formatMoney(job.balance)} owed</strong>
                      {job.nextFittingAt ? ' · fitting scheduled' : ''}
                    </p>
                  </div>
                  <div className="list-item-meta">
                    <span className={`badge ${STATUS_BADGE[job.status] ?? 'badge-default'}`}>
                      {JOB_STATUS_LABEL[job.status]}
                    </span>
                    {canUpdate && job.status !== 'delivered' && job.status !== 'cancelled' && (
                      <select
                        className="select-input"
                        value=""
                        disabled={saving}
                        aria-label={`Move job ${job.jobNumber}`}
                        onChange={(e) => {
                          const chosen = e.target.value as JobStatus;
                          if (!chosen) return;
                          // Backward moves need a reason, so collect it before calling.
                          if (JOB_STATUS_FLOW.indexOf(chosen) < JOB_STATUS_FLOW.indexOf(job.status)) {
                            setReasonFor(job.id);
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
                    {canCreate && job.balance > 0 && (
                      <Button variant="ghost" className="btn-sm" onClick={() => setPayingId(job.id)}>
                        Take payment
                      </Button>
                    )}
                    {next && canUpdate && (
                      <Button
                        className="btn-sm"
                        loading={saving}
                        onClick={() => advance(job, next)}
                      >
                        {JOB_STATUS_LABEL[next]}
                      </Button>
                    )}
                  </div>

                  {reasonFor === job.id && (
                    <div className="card">
                      <FormField
                        id={`reason-${job.id}`}
                        label="Why is this job going back a step?"
                        value={reason}
                        onChange={setReason}
                      />
                      <div className="btn-row">
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
                    <div className="card">
                      <FormField
                        id={`pay-${job.id}`}
                        label={`Amount (${formatMoney(job.balance)} outstanding)`}
                        value={payAmount}
                        onChange={setPayAmount}
                      />
                      <div className="btn-row">
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
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
