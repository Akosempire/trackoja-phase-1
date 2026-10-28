import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { CustomerService } from '../../services/customer.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';
import { Card, Page, PageHeader, btn, cn, inputClass } from '../../components/kit';

export default function CustomerFormPage() {
  const { customerId } = useParams<{ customerId: string }>();
  const isNew = !customerId || customerId === 'new';
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { hasPermission } = usePermissions();
  const storeId = profile?.currentStoreId;

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [creditLimit, setCreditLimit] = useState('0');

  const canUpdate = hasPermission('customer:update');
  const canDelete = hasPermission('customer:delete');

  useEffect(() => {
    if (isNew || !customerId) return;
    setLoading(true);
    CustomerService.getCustomer(customerId)
      .then((customer) => {
        setName(customer.name);
        setPhone(customer.phone ?? '');
        setEmail(customer.email ?? '');
        setAddress(customer.address ?? '');
        setNotes(customer.notes ?? '');
        setCreditLimit(String(customer.creditLimit));
      })
      .catch((err) => setError(err.message ?? 'Failed to load customer'))
      .finally(() => setLoading(false));
  }, [isNew, customerId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId || !user) return;

    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const customer = await CustomerService.createCustomer(storeId, user.id, {
          name,
          phone: phone || undefined,
          email: email || undefined,
          address: address || undefined,
          notes: notes || undefined,
          creditLimit: Number(creditLimit) || 0,
        });
        navigate(`/customers/${customer.id}`, { replace: true });
      } else if (customerId) {
        await CustomerService.updateCustomer(customerId, {
          name,
          phone: phone || undefined,
          email: email || undefined,
          address: address || undefined,
          notes: notes || undefined,
          creditLimit: Number(creditLimit) || 0,
        });
        navigate(`/customers/${customerId}`);
      }
    } catch (err: any) {
      setError(err.message ?? 'Failed to save customer');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!customerId || isNew) return;
    if (!confirm('Permanently delete this customer? This cannot be undone.')) return;
    setError(null);
    try {
      await CustomerService.deleteCustomer(customerId);
      navigate('/customers');
    } catch (err: any) {
      setError(err.message ?? 'Failed to delete customer');
    }
  };

  if (loading) return <PageLoader />;

  const readOnly = !isNew && !canUpdate;
  const label = 'mb-1.5 block text-[13px] font-medium text-ink-2';
  const backTo = isNew ? '/customers' : `/customers/${customerId}`;

  return (
    <Page width="form">
      <PageHeader
        title={isNew ? 'Add customer' : 'Edit customer'}
        subtitle={isNew ? 'Only a name is required. Add a phone number to find them quickly at checkout.' : readOnly ? 'You can view these details but not change them.' : 'Update contact details and credit settings.'}
      />

      {error && <div className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</div>}

      <form className="flex flex-col gap-4 lg:gap-6" onSubmit={handleSubmit}>
        <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0 lg:gap-6">
          <Card aria-labelledby="customer-contact-title">
            <div className="mb-4">
              <h2 id="customer-contact-title" className="m-0 text-[15px] font-semibold text-ink">Contact</h2>
            </div>
            <FormField id="customer-name" label="Name" value={name} onChange={setName} required placeholder="e.g. Mrs Bisi Adeyemi" autoComplete="off" />
            <div className="grid gap-x-4 sm:grid-cols-2">
              <FormField id="customer-phone" label="Phone" type="tel" inputMode="tel" value={phone} onChange={setPhone} placeholder="Optional" autoComplete="off" />
              <FormField id="customer-email" label="Email" type="email" value={email} onChange={setEmail} placeholder="Optional" autoComplete="off" />
            </div>
            <div className="[&>.form-group]:mb-0">
              <FormField id="customer-address" label="Address" value={address} onChange={setAddress} placeholder="Optional" />
            </div>
          </Card>

          <Card aria-labelledby="customer-credit-title">
            <div className="mb-4">
              <h2 id="customer-credit-title" className="m-0 text-[15px] font-semibold text-ink">Credit and notes</h2>
              <p className="m-0 mt-0.5 text-[13px] text-ink-3">How much this customer can buy on credit. Leave at 0 to turn credit off.</p>
            </div>
            <div className="mb-4 max-w-60">
              <label className={label} htmlFor="customer-credit-limit">Credit limit (₦)</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-3" aria-hidden="true">₦</span>
                <input id="customer-credit-limit" name="customer-credit-limit" className={cn(inputClass, 'pl-7 tabular-nums')} type="number" inputMode="decimal" min={0} step="any"
                  value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
              </div>
            </div>
            <label className={label} htmlFor="customer-notes">Notes</label>
            <textarea id="customer-notes" name="customer-notes" rows={3} className={cn(inputClass, 'h-auto min-h-20 py-2.5')}
              value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </Card>
        </fieldset>

        {!readOnly && (
          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              {!isNew && canDelete && (
                <Button type="button" variant="danger" onClick={handleDelete}>
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2 [&>*]:flex-1 sm:[&>*]:flex-none">
              <Link className={btn('outline')} to={backTo}>Cancel</Link>
              <Button type="submit" loading={saving}>
                {isNew ? 'Add customer' : 'Save changes'}
              </Button>
            </div>
          </div>
        )}
      </form>
    </Page>
  );
}
