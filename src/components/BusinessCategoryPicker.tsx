import { BUSINESS_CATEGORIES, type BusinessCategory } from '../config/businessModules';
import { BusinessCategoryIllustration } from './BusinessCategoryIllustration';
import { cn } from './kit';

interface BusinessCategoryPickerProps {
  value: BusinessCategory | '';
  onChange: (category: BusinessCategory) => void;
}

/** Shared by signup and onboarding so artwork and card alignment stay identical. */
export function BusinessCategoryPicker({ value, onChange }: BusinessCategoryPickerProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" role="group" aria-label="Business category">
      {BUSINESS_CATEGORIES.map(category => {
        const selected = value === category.value;
        return (
          <button
            key={category.value}
            type="button"
            className={cn('relative flex min-h-[148px] min-w-0 flex-col items-center justify-center gap-3 rounded-xl border bg-surface px-3 py-4 text-center transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
              selected ? 'border-brand bg-brand-soft ring-2 ring-brand/20' : 'border-line shadow-card hover:border-line-strong hover:bg-subtle')}
            aria-pressed={selected}
            onClick={() => onChange(category.value)}
          >
            {selected && (
              <span aria-hidden="true" className="absolute right-2.5 top-2.5 inline-flex size-5 items-center justify-center rounded-full bg-brand text-white">
                <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
              </span>
            )}
            <BusinessCategoryIllustration category={category.value} />
            <span className={cn('text-[13px] font-semibold leading-[18px]', selected ? 'text-brand-ink' : 'text-ink')}>{category.label}</span>
          </button>
        );
      })}
    </div>
  );
}
