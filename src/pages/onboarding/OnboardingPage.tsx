import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { OrganizationService } from '../../services/organization.service';
import { StoreService } from '../../services/store.service';
import { StoreContextManager } from '../../utils/store-context';
import { BUSINESS_CATEGORIES, type BusinessCategory } from '../../config/businessModules';

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, refreshProfile } = useAuth();

  const [step, setStep] = useState<1 | 2>(1);
  const [selectedCategory, setSelectedCategory] = useState<BusinessCategory | ''>('');
  const [organizationName, setOrganizationName] = useState('');
  const [storeName, setStoreName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleCategorySelect = (cat: BusinessCategory) => {
    setSelectedCategory(cat);
  };

  const handleContinue = () => {
    if (!selectedCategory) return;
    setError(null);
    setStep(2);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!user || !selectedCategory) return;

    setLoading(true);
    try {
      const organization = await OrganizationService.createOrganization(
        user.id,
        organizationName,
        'UTC',
        selectedCategory
      );
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

  if (step === 1) {
    return (
      <div className="onboarding-shell">
        <div className="onboarding-header">
          <h1 className="onboarding-title">What type of business do you run?</h1>
          <p className="onboarding-subtitle">
            TrackOja will tailor its experience to fit your industry.
          </p>
        </div>

        <div className="category-grid">
          {BUSINESS_CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              type="button"
              className={`category-card${selectedCategory === cat.value ? ' selected' : ''}`}
              onClick={() => handleCategorySelect(cat.value)}
            >
              <span className="category-card-emoji">{cat.emoji}</span>
              <span className="category-card-label">{cat.label}</span>
            </button>
          ))}
        </div>

        <div className="onboarding-footer">
          <Button onClick={handleContinue} disabled={!selectedCategory}>
            Continue →
          </Button>
        </div>
      </div>
    );
  }

  const chosen = BUSINESS_CATEGORIES.find((c) => c.value === selectedCategory);

  return (
    <div className="onboarding-shell">
      <div className="onboarding-header">
        <button
          type="button"
          className="onboarding-back"
          onClick={() => setStep(1)}
        >
          ← Back
        </button>
        <div className="onboarding-chosen-badge">
          <span>{chosen?.emoji}</span>
          <span>{chosen?.label}</span>
        </div>
        <h1 className="onboarding-title">Set up your business</h1>
        <p className="onboarding-subtitle">Tell us your business name and your first store.</p>
      </div>

      <div className="card" style={{ maxWidth: 480, margin: '0 auto', width: '100%' }}>
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
            label="Store / branch name"
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
      </div>
    </div>
  );
}
