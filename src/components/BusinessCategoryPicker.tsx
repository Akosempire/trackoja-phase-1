import { BUSINESS_CATEGORIES, type BusinessCategory } from '../config/businessModules';
import { BusinessCategoryIllustration } from './BusinessCategoryIllustration';

interface BusinessCategoryPickerProps {
  value: BusinessCategory | '';
  onChange: (category: BusinessCategory) => void;
}

/** Shared by signup and onboarding so artwork and card alignment stay identical. */
export function BusinessCategoryPicker({ value, onChange }: BusinessCategoryPickerProps) {
  return (
    <div className="category-grid onboarding-category-grid" role="group" aria-label="Business category">
      {BUSINESS_CATEGORIES.map(category => (
        <button key={category.value} type="button" className={`category-card${value === category.value ? ' selected' : ''}`} aria-pressed={value === category.value} onClick={() => onChange(category.value)}>
          <BusinessCategoryIllustration category={category.value} />
          <span className="category-card-label">{category.label}</span>
        </button>
      ))}
    </div>
  );
}
