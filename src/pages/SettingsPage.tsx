import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useBusinessContext } from '../contexts/BusinessContext';
import { StoreService } from '../services/store.service';
import { OrganizationService } from '../services/organization.service';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { PageLoader } from '../components/ui/PageLoader';
import { StateBlock } from '../components/ui/StateBlock';
import { BUSINESS_CATEGORIES, type BusinessCategory } from '../config/businessModules';
import type { Store } from '../types';
import { ThemeSelect } from '../components/ThemeSelect';
import { UsetallyConnection } from '../components/UsetallyConnection';
import { DailyEmailCard, PrivacyDataCard } from '../components/PrivacyData';
import { DiscountLimitCard } from '../components/settings/DiscountLimitCard';
import { useToast } from '../components/ui/Toast';
import { Card, CardHead, Page, PageHeader, btn, cn } from '../components/kit';

export default function SettingsPage() {
  const toast = useToast();
  const { profile } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const { category: currentCategory, config, refresh: refreshBusiness } = useBusinessContext();
  const storeId = profile?.currentStoreId;
  const orgId = profile?.currentOrgId;
  const canUpdate = hasPermission('store:update');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [store, setStore] = useState<Store | null>(null);

  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [pendingCategory, setPendingCategory] = useState<BusinessCategory | ''>(currentCategory);
  const [savingCategory, setSavingCategory] = useState(false);

  useEffect(() => {
    setPendingCategory(currentCategory);
  }, [currentCategory]);

  useEffect(() => {
    if (!storeId) {
      setLoading(false);
      return;
    }
    StoreService.getStore(storeId)
      .then((s) => {
        setStore(s);
        setName(s.name);
        setPhone(s.phone ?? '');
        setEmail(s.email ?? '');
        setAddress(s.address ?? '');
        setCity(s.city ?? '');
        setState(s.state ?? '');
      })
      .catch((err) => setError(err.message ?? 'Failed to load store'))
      .finally(() => setLoading(false));
  }, [storeId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!storeId) return;

    setSaving(true);
    setError(null);
    const toastId = toast.loading('Saving store settings…', { dedupeKey: 'store-settings' });
    try {
      const updated = await StoreService.updateStore(storeId, {
        name,
        phone: phone || undefined,
        email: email || undefined,
        address: address || undefined,
        city: city || undefined,
        state: state || undefined,
      });
      setStore(updated);
      toast.update(toastId, { variant: 'success', message: 'Settings saved', description: 'Your store details are up to date.' });
    } catch (err: any) {
      const message = err.message ?? 'Failed to save settings';
      setError(message);
      toast.update(toastId, { variant: 'error', message: 'Settings were not saved', description: message });
    } finally {
      setSaving(false);
    }
  };

  const handleSaveCategory = async () => {
    if (!orgId || !pendingCategory || pendingCategory === currentCategory) {
      setShowCategoryPicker(false);
      return;
    }
    setSavingCategory(true);
    setError(null);
    const toastId = toast.loading('Updating business type…', { dedupeKey: 'business-type' });
    try {
      await OrganizationService.updateBusinessCategory(orgId, pendingCategory);
      await refreshBusiness();
      setShowCategoryPicker(false);
      toast.update(toastId, { variant: 'success', message: 'Business type updated' });
    } catch (err: any) {
      const message = err.message ?? 'Failed to update business type';
      setError(message);
      toast.update(toastId, { variant: 'error', message: 'Business type was not updated', description: message });
    } finally {
      setSavingCategory(false);
    }
  };

  if (permsLoading || loading) return <PageLoader />;

  return (
    <Page width="form">
      <PageHeader title="Settings" subtitle="Store profile and business type" />

      {error && <div className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</div>}

      <div className="flex flex-col gap-4 lg:gap-6">
        {!store ? (
          <Card>
            <StateBlock variant="unavailable" title="No store selected" body="Choose a workspace before changing store settings." />
          </Card>
        ) : (
          <Card>
            <form onSubmit={handleSubmit} aria-labelledby="store-details-title">
              <CardHead title={<span id="store-details-title">Store details</span>}
                hint={canUpdate ? 'Shown on receipts and invoices' : 'Only managers with store access can change these details'} />
              <FormField id="store-name" label="Store name" value={name} onChange={setName} required disabled={!canUpdate} />
              <div className="grid gap-x-4 sm:grid-cols-2">
                <FormField id="store-phone" label="Phone" value={phone} onChange={setPhone} placeholder="Optional" disabled={!canUpdate} />
                <FormField id="store-email" label="Email" type="email" value={email} onChange={setEmail} placeholder="Optional" disabled={!canUpdate} />
              </div>
              <FormField id="store-address" label="Address" value={address} onChange={setAddress} placeholder="Optional" disabled={!canUpdate} />
              <div className="grid gap-x-4 sm:grid-cols-2">
                <FormField id="store-city" label="City" value={city} onChange={setCity} placeholder="Optional" disabled={!canUpdate} />
                <FormField id="store-state" label="State" value={state} onChange={setState} placeholder="Optional" disabled={!canUpdate} />
              </div>
              <div className="grid gap-x-4 sm:grid-cols-2">
                <FormField id="store-currency" label="Currency" value={store.currency} onChange={() => {}} disabled />
                <FormField id="store-timezone" label="Timezone" value={store.timezone} onChange={() => {}} disabled />
              </div>

              {canUpdate && (
                <div className="mt-2 flex justify-end border-t border-line pt-4">
                  <Button type="submit" loading={saving} className="w-full sm:w-auto">
                    Save changes
                  </Button>
                </div>
              )}
            </form>
          </Card>
        )}

        {canUpdate && (
          <Card aria-labelledby="business-type-title">
            {showCategoryPicker ? (
              <>
                <CardHead title={<span id="business-type-title">Business type</span>} hint="Changes the words, menus and reports TrackOja shows you" />
                <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="Business types">
                  {BUSINESS_CATEGORIES.map((cat) => {
                    const selected = pendingCategory === cat.value;
                    return (
                      <button
                        key={cat.value}
                        type="button"
                        aria-pressed={selected}
                        className={cn('flex min-h-[56px] flex-col items-start justify-center rounded-lg border px-3.5 py-2.5 text-left transition-colors',
                          selected ? 'border-brand bg-brand-soft ring-1 ring-brand' : 'border-line-strong bg-surface hover:bg-subtle')}
                        onClick={() => setPendingCategory(cat.value)}
                      >
                        <span className={cn('text-sm font-semibold', selected ? 'text-brand-ink' : 'text-ink')}>{cat.label}</span>
                        <span className="mt-0.5 text-xs leading-4 text-ink-3">{cat.description}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button variant="ghost" onClick={() => { setShowCategoryPicker(false); setPendingCategory(currentCategory); }}>
                    Cancel
                  </Button>
                  <Button variant="outline" onClick={handleSaveCategory} loading={savingCategory} disabled={!pendingCategory}>
                    Save business type
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 id="business-type-title" className="m-0 text-[15px] font-semibold text-ink">Business type</h2>
                  <p className="m-0 mt-0.5 truncate text-[13px] text-ink-3">{config.label}</p>
                </div>
                <Button variant="outline" onClick={() => setShowCategoryPicker(true)} className="btn-sm shrink-0">
                  Change
                </Button>
              </div>
            )}
          </Card>
        )}

        {store && storeId && <DiscountLimitCard storeId={storeId} canUpdate={canUpdate} />}

        <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="m-0 text-[15px] font-semibold text-ink">Payment providers</h2>
            <p className="m-0 mt-0.5 text-[13px] text-ink-3">Connect Moniepoint POS and manage terminals for customer payments.</p>
          </div>
          <Link className={cn(btn('outline'), 'shrink-0 self-start sm:self-auto')} to="/settings/payments/moniepoint">Moniepoint POS settings</Link>
        </Card>

        {canUpdate && store && storeId && <UsetallyConnection storeId={storeId} storeName={store.name} />}

        {store && storeId && <DailyEmailCard storeId={storeId} canUpdate={canUpdate} />}

        {store && storeId && <PrivacyDataCard storeId={storeId} storeName={store.name} orgId={orgId} canExport={canUpdate} />}

        <Card aria-label="Appearance" className="[&_.tl-theme]:text-[15px] [&_.tl-theme]:font-semibold [&_.tl-theme]:text-ink [&_select]:h-9 [&_select]:font-normal">
          <ThemeSelect />
        </Card>
      </div>
    </Page>
  );
}
