import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useBusinessContext } from '../../contexts/BusinessContext';
import { usePermissions } from '../../hooks/usePermissions';
import {
  EXPENSE_CATEGORIES,
  ExpenseService,
  type Expense,
  type ExpenseSummaryRow,
  type Supplier,
} from '../../services/expense.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import { SectionHead } from '../../components/ui/SectionHead';
import { StateBlock } from '../../components/ui/StateBlock';
import { useToast } from '../../components/ui/Toast';
import { getBusinessExperience } from '../../config/businessExperience';
import { formatMoney } from '../../utils/format';

function startOfMonth(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function ExpensesPage() {
  const { profile } = useAuth();
  const { category } = useBusinessContext();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const storeId = profile?.currentStoreId;
  const experience = getBusinessExperience(category);
  const toast = useToast();

  const canCreate = hasPermission('expense:create');
  const canDelete = hasPermission('expense:delete');

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [summary, setSummary] = useState<ExpenseSummaryRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [range, setRange] = useState({ from: startOfMonth(), to: today() });
  const [showForm, setShowForm] = useState(false);

  const [form, setForm] = useState({
    description: '',
    amount: '',
    category: 'stock',
    spentOn: today(),
    paymentMethod: 'cash',
    supplierId: '',
  });

  const load = useCallback(() => {
    if (!storeId) {
      setLoading(false);
      setError('Choose a business workspace to view its expenses.');
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      ExpenseService.list(storeId, { from: range.from, to: range.to }),
      ExpenseService.summary(storeId, range.from, range.to),
      ExpenseService.listSuppliers(storeId).catch(() => [] as Supplier[]),
    ])
      .then(([rows, summaryRows, supplierRows]) => {
        setExpenses(rows);
        setSummary(summaryRows);
        setSuppliers(supplierRows);
      })
      .catch((err) => setError(err?.message ?? 'Could not load expenses'))
      .finally(() => setLoading(false));
  }, [storeId, range.from, range.to]);

  useEffect(load, [load]);

  const submit = async () => {
    if (!storeId) return;
    const amount = Number(form.amount);
    // A waiting toast that becomes the outcome in place, so the merchant sees one
    // message for the whole operation rather than nothing then a banner elsewhere.
    const pending = toast.loading('Recording expense…', { description: form.description });
    setSaving(true);
    try {
      await ExpenseService.create({
        storeId,
        description: form.description,
        amount,
        category: form.category,
        spentOn: form.spentOn,
        paymentMethod: form.paymentMethod,
        supplierId: form.supplierId || null,
      });
      toast.update(pending, {
        variant: 'success',
        message: `Recorded ${formatMoney(amount)}`,
        description: form.description,
      });
      setForm({ ...form, description: '', amount: '', supplierId: '' });
      setShowForm(false);
      load();
    } catch (err) {
      toast.update(pending, {
        variant: 'error',
        message: 'Could not record the expense',
        description: (err as Error)?.message ?? undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const remove = async (expense: Expense) => {
    if (!window.confirm(`Delete "${expense.description}"? This cannot be undone.`)) return;
    const pending = toast.loading('Deleting expense…', { description: expense.description });
    setSaving(true);
    try {
      await ExpenseService.remove(expense.id);
      toast.update(pending, { variant: 'success', message: 'Expense deleted' });
      load();
    } catch (err) {
      toast.update(pending, {
        variant: 'error',
        message: 'Could not delete the expense',
        description: (err as Error)?.message ?? undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading || permsLoading) return <PageLoader />;

  const periodTotal = summary.reduce((sum, row) => sum + row.total, 0);

  if (error) {
    return (
      <div className="page" data-business-type={category} data-stock-model={experience.stock.model}>
        <div className="page-header">
          <div>
            <h1 className="page-title">Expenses</h1>
            <p className="page-subtitle">What this business spent, and where it went</p>
          </div>
        </div>
        <div className="card">
          <StateBlock variant="error" title="Could not load expenses" body={error}
            actions={<Button variant="outline" className="btn-sm" onClick={load}>Try again</Button>} />
        </div>
      </div>
    );
  }

  return (
    <div className="page" data-business-type={category} data-stock-model={experience.stock.model}>
      <div className="page-header">
        <div>
          <h1 className="page-title">Expenses</h1>
          <p className="page-subtitle">
            What this business spent, and where it went
            {canCreate ? '' : ' · view only'}
          </p>
        </div>
        {canCreate && (
          <Button onClick={() => setShowForm((open) => !open)}>
            {showForm ? 'Cancel' : 'Record expense'}
          </Button>
        )}
      </div>

      {/* Period selector: expenses are reported on the date money was spent. */}
      <div className="card">
        <div className="auth-form-row">
          <FormField
            id="expense-from"
            label="From"
            type="date"
            value={range.from}
            onChange={(v) => setRange({ ...range, from: v })}
          />
          <FormField
            id="expense-to"
            label="To"
            type="date"
            value={range.to}
            onChange={(v) => setRange({ ...range, to: v })}
          />
        </div>
        <div>
          <p className="stat-label">Total in period</p>
          <p className="stat-value">{formatMoney(periodTotal)}</p>
          <p className="page-subtitle">
            {expenses.length} entr{expenses.length === 1 ? 'y' : 'ies'}
          </p>
        </div>
      </div>

      {showForm && canCreate && (
        <form
          className="card"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="list-item-title">Record an expense</p>
          <FormField
            id="expense-description"
            label="What was it for?"
            value={form.description}
            onChange={(v) => setForm({ ...form, description: v })}
            required
          />
          <div className="auth-form-row">
            <FormField
              id="expense-amount"
              label="Amount (NGN)"
              value={form.amount}
              onChange={(v) => setForm({ ...form, amount: v })}
              required
            />
            <FormField
              id="expense-date"
              label="Date spent"
              type="date"
              value={form.spentOn}
              onChange={(v) => setForm({ ...form, spentOn: v })}
            />
          </div>
          <div className="auth-form-row">
            <label className="form-group">
              <span className="form-label">Category</span>
              <select
                className="select-input"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.charAt(0).toUpperCase() + c.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-group">
              <span className="form-label">Paid by</span>
              <select
                className="select-input"
                value={form.paymentMethod}
                onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
              >
                {['cash', 'transfer', 'card', 'credit', 'other'].map((m) => (
                  <option key={m} value={m}>
                    {m.charAt(0).toUpperCase() + m.slice(1)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {suppliers.length > 0 && (
            <label className="form-group">
              <span className="form-label">Supplier (optional)</span>
              <select
                className="select-input"
                value={form.supplierId}
                onChange={(e) => setForm({ ...form, supplierId: e.target.value })}
              >
                <option value="">Not linked to a supplier</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button
            type="submit"
            loading={saving}
            disabled={!form.description.trim() || !form.amount || Number(form.amount) <= 0}
          >
            Save expense
          </Button>
        </form>
      )}

      {summary.length > 0 && (
        <div className="card">
          <SectionHead title="Where it went" sub="Expense categories for the selected period" />
          <div className="list">
            {summary.map((row) => (
              <div className="list-item" key={row.category}>
                <div>
                  <p className="list-item-title">
                    {row.category.charAt(0).toUpperCase() + row.category.slice(1)}
                  </p>
                  <p className="list-item-subtitle">
                    {row.entryCount} entr{row.entryCount === 1 ? 'y' : 'ies'}
                  </p>
                </div>
                <div className="list-item-meta">
                  <span className="badge badge-default">{row.share}%</span>
                  <span className="list-item-title">{formatMoney(row.total)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <SectionHead title="Recorded expenses" sub={`${range.from} to ${range.to}`} />
        {expenses.length === 0 ? (
          <StateBlock
            title="No expenses in this period"
            body="Record what the business spent to see where the money goes."
            actions={canCreate ? <Button className="btn-sm" onClick={() => setShowForm(true)}>Record expense</Button> : null}
          />
        ) : (
          <div className="list">
            {expenses.map((expense) => (
              <div className="list-item" key={expense.id}>
                <div>
                  <p className="list-item-title">{expense.description}</p>
                  <p className="list-item-subtitle">
                    {expense.spentOn} · {expense.category}
                    {expense.supplierName ? ` · ${expense.supplierName}` : ''}
                    {expense.paymentMethod ? ` · ${expense.paymentMethod}` : ''}
                  </p>
                  <p className="list-item-subtitle">
                    Recorded by {expense.recordedByEmail ?? 'unknown'}
                  </p>
                </div>
                <div className="list-item-meta">
                  <span className="list-item-title">{formatMoney(expense.amount, expense.currency)}</span>
                  {canDelete && (
                    <Button variant="ghost" className="btn-sm" onClick={() => remove(expense)}>
                      Delete
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
