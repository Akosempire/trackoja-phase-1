import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AuthLayout } from '../../components/AuthLayout';
import { FormField } from '../../components/ui/FormField';
import { Button } from '../../components/ui/Button';
import { OrganizationService } from '../../services/organization.service';
import { StoreService } from '../../services/store.service';
import { StoreContextManager } from '../../utils/store-context';
import { useAuth } from '../../contexts/AuthContext';

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();
  const [organizationName, setOrganizationName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!user) return;

    setLoading(true);
    try {
      const organization = await OrganizationService.createOrganization(user.id, organizationName);
      const store = await StoreService.createStore(organization.id, user.id, { name: storeName });

      StoreContextManager.switchStore(store, user.id);
      await refreshProfile();

      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="Set up your business"
      subtitle="Tell us about your business and your first store"
    >
      {error && <div className="alert alert-error">{error}</div>}
      <form onSubmit={handleSubmit}>
        <FormField
          id="organizationName"
          label="Business name"
          value={organizationName}
          onChange={setOrganizationName}
          placeholder="e.g. Akosua Foods Ltd"
          autoComplete="organization"
          required
        />
        <FormField
          id="storeName"
          label="Store name"
          value={storeName}
          onChange={setStoreName}
          placeholder="e.g. Main Branch"
          autoComplete="off"
          required
        />
        <Button type="submit" loading={loading}>
          Continue to dashboard
        </Button>
      </form>
    </AuthLayout>
  );
}
