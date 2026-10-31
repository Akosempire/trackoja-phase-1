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
import { StateBlock } from '../../components/ui/StateBlock';
import { Card, Empty, Page, PageHeader, Stat, cn, inputClass } from '../../components/kit';
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

const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ');

const PAYMENT_METHODS = ['cash', 'transfer', 'card', 'credit', 'other'];

function shortDate(value: string, withYear = false): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: withYear ? 'numeric' : undefined });
}

function dayHeading(value: string): string {
  if (value === today()) return 'Today';
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (value === yesterday.toISOString().slice(0, 10)) return 'Yesterday';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
}

/** A row of tappable choices that behaves like a radio group. */
function ChoiceChips({ legend, name, options, value, onChange }: { legend: string; name: string; options: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <fieldset className="m-0 mb-4 min-w-0 border-0 p-0">
      <legend className="mb-1.5 block p-0 text-[13px] font-medium text-ink-2">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option === value;
          return (
            <label key={option}
              className={cn('inline-flex h-9 cursor-pointer items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-brand/20',
                active ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line-strong bg-surface text-ink-2 hover:bg-hover hover:text-ink')}>
              <input type="radio" name={name} value={option} checked={active} onChange={() => onChange(option)} className="sr-only" />
              {titleCase(option)}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
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
  const isThisMonth = range.from === startOfMonth() && range.to === today();
  const periodLabel = isThisMonth ? 'This month' : `${shortDate(range.from)} – ${shortDate(range.to, true)}`;
  const top = summary.reduce<ExpenseSummaryRow | null>((best, row) => (!best || row.total > best.total ? row : best), null);
  const average = expenses.length ? periodTotal / expenses.length : 0;

  const days: Array<{ day: string; items: Expense[]; total: number }> = [];
  for (const expense of expenses) {
    let group = days[days.length - 1];
    if (!group || group.day !== expense.spentOn) {
      group = { day: expense.spentOn, items: [], total: 0 };
      days.push(group);
    }
    group.items.push(expense);
    group.total += expense.amount;
  }

  const header = (
    <PageHeader
      title="Expenses"
      subtitle={<>What this business spent, and where it went{canCreate ? '' : ' · view only'}</>}
      actions={canCreate && !error && (
        <Button variant={showForm ? 'outline' : 'primary'} onClick={() => setShowForm((open) => !open)} aria-expanded={showForm}>
          {showForm ? 'Cancel' : 'Record expense'}
        </Button>
      )}
    />
  );

  if (error) {
    return (
      <div data-business-type={category} data-stock-model={experience.stock.model}>
        <Page>
          {header}
          <Card>
            <StateBlock variant="error" title="Could not load expenses" body={error}
              actions={<Button variant="outline" className="btn-sm" onClick={load}>Try again</Button>} />
          </Card>
        </Page>
      </div>
    );
  }

  const label = 'mb-1.5 block text-[13px] font-medium text-ink-2';

  return (
    <div data-business-type={category} data-stock-model={experience.stock.model}>
      <Page>
        {header}

        {showForm && canCreate && (
          <form
            className="mb-4 lg:mb-6"
            aria-labelledby="expense-form-title"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Card className="border-brand-line">
              <div className="mb-4">
                <h2 id="expense-form-title" className="m-0 text-[15px] font-semibold text-ink">Record an expense</h2>
                <p className="m-0 mt-0.5 text-[13px] text-ink-3">Money that left the business: stock, rent, fuel, salaries.</p>
              </div>
              <div className="grid gap-x-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
                <div className="mb-4">
                  <label className={label} htmlFor="expense-amount">Amount (NGN)</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3" aria-hidden="true">₦</span>
                    <input id="expense-amount" name="expense-amount" className={cn(inputClass, 'h-11 pl-7 text-base font-semibold tabular-nums')}
                      type="number" inputMode="decimal" min={0} step="any" required placeholder="0"
                      value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                  </div>
                </div>
                <FormField
                  id="expense-description"
                  label="What was it for?"
                  value={form.description}
                  onChange={(v) => setForm({ ...form, description: v })}
                  placeholder="e.g. Diesel for generator"
                  required
                />
              </div>
              <ChoiceChips legend="Category" name="expense-category" options={EXPENSE_CATEGORIES} value={form.category}
                onChange={(v) => setForm({ ...form, category: v })} />
              <ChoiceChips legend="Paid by" name="expense-method" options={PAYMENT_METHODS} value={form.paymentMethod}
                onChange={(v) => setForm({ ...form, paymentMethod: v })} />
              <div className="grid gap-x-4 sm:grid-cols-2">
                <FormField
                  id="expense-date"
                  label="Date spent"
                  type="date"
                  value={form.spentOn}
                  onChange={(v) => setForm({ ...form, spentOn: v })}
                />
                {suppliers.length > 0 && (
                  <div className="mb-4">
                    <label className={label} htmlFor="expense-supplier">Supplier (optional)</label>
                    <select
                      id="expense-supplier"
                      className={inputClass}
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
                  </div>
                )}
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Not now</Button>
                <Button
                  type="submit"
                  loading={saving}
                  disabled={!form.description.trim() || !form.amount || Number(form.amount) <= 0}
                >
                  Save expense
                </Button>
              </div>
            </Card>
          </form>
        )}

        {/* Period selector: expenses are reported on the date money was spent. */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1 sm:w-40 sm:flex-none">
              <label className="mb-1 block text-xs font-medium text-ink-3" htmlFor="expense-from">From</label>
              <input id="expense-from" name="expense-from" type="date" className={inputClass} value={range.from}
                onChange={(e) => setRange({ ...range, from: e.target.value })} />
            </div>
            <span className="pb-2.5 text-ink-3" aria-hidden="true">–</span>
            <div className="min-w-0 flex-1 sm:w-40 sm:flex-none">
              <label className="mb-1 block text-xs font-medium text-ink-3" htmlFor="expense-to">To</label>
              <input id="expense-to" name="expense-to" type="date" className={inputClass} value={range.to}
                onChange={(e) => setRange({ ...range, to: e.target.value })} />
            </div>
          </div>
          {!isThisMonth && (
            <button type="button" className="h-10 self-start rounded-md px-3 text-[13px] font-semibold text-brand-ink hover:bg-brand-soft sm:self-auto"
              onClick={() => setRange({ from: startOfMonth(), to: today() })}>
              Back to this month
            </button>
          )}
        </div>

        <section className="mb-4 grid grid-cols-2 gap-3 lg:mb-6 lg:grid-cols-4 lg:gap-4" aria-label="Expense summary">
          <div className="col-span-2 lg:col-span-1">
            <Stat label={`Total in period · ${periodLabel}`} value={formatMoney(periodTotal)}
              hint={`${expenses.length} entr${expenses.length === 1 ? 'y' : 'ies'}`} />
          </div>
          <Stat label="Biggest category" value={top ? titleCase(top.category) : '—'} hint={top ? `${formatMoney(top.total)} · ${top.share}%` : 'Nothing yet'} />
          <Stat label="Average entry" value={expenses.length ? formatMoney(Math.round(average)) : '—'} />
          <div className="col-span-2 hidden lg:col-span-1 lg:block">
            <Stat label="Categories used" value={summary.length} hint={`of ${EXPENSE_CATEGORIES.length}`} />
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-3 lg:gap-6">
          {summary.length > 0 && (
            <Card className="min-w-0 self-start lg:col-start-3 lg:row-start-1" aria-labelledby="where-title">
              <div className="mb-4">
                <h2 id="where-title" className="m-0 text-[15px] font-semibold text-ink">Where it went</h2>
                <p className="m-0 mt-0.5 text-[13px] text-ink-3">Expense categories for the selected period</p>
              </div>
              <ul className="m-0 flex list-none flex-col gap-3.5 p-0">
                {summary.map((row, index) => (
                  <li key={row.category}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="m-0 min-w-0 truncate text-sm font-medium text-ink">
                        {titleCase(row.category)}
                        <span className="ml-1.5 text-xs font-normal text-ink-3">
                          {row.entryCount} entr{row.entryCount === 1 ? 'y' : 'ies'}
                        </span>
                      </p>
                      <p className="m-0 shrink-0 text-sm font-semibold tabular-nums text-ink">{formatMoney(row.total)}</p>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-tray" aria-hidden="true">
                        <span className={cn('block h-full rounded-full', index === 0 ? 'bg-brand' : 'bg-brand/45')} style={{ width: `${Math.max(row.share, 2)}%` }} />
                      </span>
                      <span className="w-9 shrink-0 text-right text-xs tabular-nums text-ink-3">{row.share}%</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className={cn('min-w-0 lg:row-start-1', summary.length > 0 ? 'lg:col-span-2' : 'lg:col-span-3')}>
            <div className="mb-2 flex items-baseline justify-between gap-3 px-1">
              <h2 className="m-0 text-[15px] font-semibold text-ink">Recorded expenses</h2>
              <p className="m-0 text-xs tabular-nums text-ink-3">{shortDate(range.from)} to {shortDate(range.to, true)}</p>
            </div>
            {expenses.length === 0 ? (
              <Empty
                title="No expenses in this period"
                body="Record what the business spent to see where the money goes."
                action={canCreate ? <Button className="btn-sm" onClick={() => setShowForm(true)}>Record expense</Button> : null}
              />
            ) : (
              <Card padded={false} className="overflow-hidden">
                {days.map((group) => (
                  <section key={group.day} aria-label={dayHeading(group.day)} className="border-t border-line first:border-t-0">
                    <div className="flex items-baseline justify-between gap-3 bg-subtle px-4 py-2 sm:px-5">
                      <h3 className="m-0 text-xs font-semibold text-ink-2">{dayHeading(group.day)}</h3>
                      <p className="m-0 text-xs font-medium tabular-nums text-ink-3">{formatMoney(group.total)}</p>
                    </div>
                    <ul className="m-0 list-none divide-y divide-line p-0">
                      {group.items.map((expense) => (
                        <li className="flex items-center gap-3 px-4 py-3 sm:px-5" key={expense.id}>
                          <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-tray text-sm font-semibold text-ink-2">
                            {expense.category.charAt(0).toUpperCase()}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="m-0 truncate text-sm font-medium text-ink">{expense.description}</p>
                            <p className="m-0 mt-0.5 truncate text-xs text-ink-3">
                              {titleCase(expense.category)}
                              {expense.paymentMethod ? ` · ${titleCase(expense.paymentMethod)}` : ''}
                              {expense.supplierName ? ` · ${expense.supplierName}` : ''}
                              <span className="hidden sm:inline"> · Recorded by {expense.recordedByEmail ?? 'unknown'}</span>
                            </p>
                          </div>
                          <p className="m-0 shrink-0 text-sm font-semibold tabular-nums text-ink">{formatMoney(expense.amount, expense.currency)}</p>
                          {canDelete && (
                            <button type="button" className="-mr-2 inline-flex size-10 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                              onClick={() => remove(expense)} disabled={saving} aria-label={`Delete ${expense.description}`} title="Delete">
                              <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" /></svg>
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </Card>
            )}
          </div>
        </div>
      </Page>
    </div>
  );
}
