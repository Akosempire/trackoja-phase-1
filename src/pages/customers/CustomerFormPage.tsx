import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePermissions } from '../../hooks/usePermissions';
import { CustomerService } from '../../services/customer.service';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { PageLoader } from '../../components/ui/PageLoader';

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

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">{isNew ? 'Add customer' : 'Edit customer'}</h1>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      <form className="card" onSubmit={handleSubmit}>
        <FormField id="customer-name" label="Name" value={name} onChange={setName} required />
        <div className="auth-form-row">
          <FormField id="customer-phone" label="Phone" value={phone} onChange={setPhone} placeholder="Optional" />
          <FormField id="customer-email" label="Email" type="email" value={email} onChange={setEmail} placeholder="Optional" />
        </div>
        <FormField id="customer-address" label="Address" value={address} onChange={setAddress} placeholder="Optional" />
        <FormField id="customer-notes" label="Notes" value={notes} onChange={setNotes} placeholder="Optional" />
        <FormField
          id="customer-credit-limit"
          label="Credit limit (₦)"
          type="number"
          value={creditLimit}
          onChange={setCreditLimit}
        />

        {!readOnly && (
          <div className="btn-row">
            <Button type="submit" loading={saving} className="btn-sm">
              {isNew ? 'Add customer' : 'Save changes'}
            </Button>
            {!isNew && canDelete && (
              <Button type="button" variant="ghost" className="btn-sm" onClick={handleDelete}>
                Delete
              </Button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
