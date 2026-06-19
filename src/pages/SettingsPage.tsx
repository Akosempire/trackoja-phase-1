import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../hooks/usePermissions';
import { useBusinessContext } from '../contexts/BusinessContext';
import { StoreService } from '../services/store.service';
import { OrganizationService } from '../services/organization.service';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { PageLoader } from '../components/ui/PageLoader';
import { BUSINESS_CATEGORIES, type BusinessCategory } from '../config/businessModules';
import type { Store } from '../types';

export default function SettingsPage() {
  const { profile } = useAuth();
  const { hasPermission, loading: permsLoading } = usePermissions();
  const { category: currentCategory, config, refresh: refreshBusiness } = useBusinessContext();
  const storeId = profile?.currentStoreId;
  const orgId = profile?.currentOrgId;
  const canUpdate = hasPermission('store:update');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
    setSaved(false);
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
      setSaved(true);
    } catch (err: any) {
      setError(err.message ?? 'Failed to save settings');
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
    try {
      await OrganizationService.updateBusinessCategory(orgId, pendingCategory);
      await refreshBusiness();
      setShowCategoryPicker(false);
      setSaved(true);
    } catch (err: any) {
      setError(err.message ?? 'Failed to update business type');
    } finally {
      setSavingCategory(false);
    }
  };

  if (permsLoading || loading) return <PageLoader />;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Store profile and business type</p>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {saved && <div className="alert alert-success">Settings saved.</div>}

      {canUpdate && (
        <div className="card" style={{ marginBottom: 16 }}>
          <p className="list-item-title" style={{ marginBottom: 12 }}>Business type</p>
          {showCategoryPicker ? (
            <>
              <div className="category-grid" style={{ marginBottom: 16 }}>
                {BUSINESS_CATEGORIES.map((cat) => (
                  <button
                    key={cat.value}
                    type="button"
                    className={`category-card${pendingCategory === cat.value ? ' selected' : ''}`}
                    onClick={() => setPendingCategory(cat.value)}
                  >
                    <span className="category-card-emoji">{cat.emoji}</span>
                    <span className="category-card-label">{cat.label}</span>
                  </button>
                ))}
              </div>
              <div className="btn-row">
                <Button onClick={handleSaveCategory} loading={savingCategory} disabled={!pendingCategory} className="btn-sm">
                  Save business type
                </Button>
                <Button variant="ghost" onClick={() => { setShowCategoryPicker(false); setPendingCategory(currentCategory); }} className="btn-sm">
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="onboarding-chosen-badge" style={{ margin: 0 }}>
                <span>{config.emoji}</span>
                <span>{config.label}</span>
              </span>
              <Button variant="ghost" onClick={() => setShowCategoryPicker(true)} className="btn-sm">
                Change
              </Button>
            </div>
          )}
        </div>
      )}

      {!store ? (
        <div className="empty-state">No store selected.</div>
      ) : (
        <form className="card" onSubmit={handleSubmit}>
          <p className="list-item-title" style={{ marginBottom: 12 }}>Store details</p>
          <FormField id="store-name" label="Store name" value={name} onChange={setName} required disabled={!canUpdate} />
          <div className="auth-form-row">
            <FormField id="store-phone" label="Phone" value={phone} onChange={setPhone} placeholder="Optional" disabled={!canUpdate} />
            <FormField id="store-email" label="Email" type="email" value={email} onChange={setEmail} placeholder="Optional" disabled={!canUpdate} />
          </div>
          <FormField id="store-address" label="Address" value={address} onChange={setAddress} placeholder="Optional" disabled={!canUpdate} />
          <div className="auth-form-row">
            <FormField id="store-city" label="City" value={city} onChange={setCity} placeholder="Optional" disabled={!canUpdate} />
            <FormField id="store-state" label="State" value={state} onChange={setState} placeholder="Optional" disabled={!canUpdate} />
          </div>
          <div className="auth-form-row">
            <FormField id="store-currency" label="Currency" value={store.currency} onChange={() => {}} disabled />
            <FormField id="store-timezone" label="Timezone" value={store.timezone} onChange={() => {}} disabled />
          </div>

          {canUpdate && (
            <div className="btn-row">
              <Button type="submit" loading={saving} className="btn-sm">
                Save changes
              </Button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
