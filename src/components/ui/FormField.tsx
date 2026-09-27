import { useRef, useState } from 'react';

interface FormFieldProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  autoComplete?: string;
  required?: boolean;
  disabled?: boolean;
}

export function FormField({
  id,
  label,
  type = 'text',
  value,
  onChange,
  placeholder,
  error,
  autoComplete,
  required,
  disabled,
}: FormFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // A password field gets a reveal control; every other type is untouched. The
  // toggle is a sibling button rather than an input adornment, so the field keeps
  // its own label, error wiring and autocomplete behaviour.
  const isPassword = type === 'password';
  const inputType = revealed ? 'text' : type;

  const toggleReveal = () => {
    setRevealed((current) => !current);
    // Put the caret back where the user was typing rather than leaving focus on the
    // button, so revealing a typo does not cost an extra tap.
    inputRef.current?.focus();
  };

  return (
    <div className="form-group">
      <label className="form-label" htmlFor={id}>
        {label}
      </label>

      <div className={isPassword ? 'form-input-wrap' : undefined}>
        <input
          ref={inputRef}
          id={id}
          name={id}
          className={`form-input${error ? ' has-error' : ''}`}
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          required={required}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />

        {isPassword && (
          <button
            type="button"
            className="form-input-reveal"
            onClick={toggleReveal}
            disabled={disabled}
            aria-label={revealed ? 'Hide password' : 'Show password'}
            aria-pressed={revealed}
            // Described by, not labelled by: the button must not become the field's
            // accessible name.
            aria-controls={id}
            title={revealed ? 'Hide password' : 'Show password'}
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        )}
      </div>

      {error && <span className="form-error" id={`${id}-error`} role="alert">{error}</span>}
    </div>
  );
}

const ICON_PROPS = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function EyeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M2.5 12S6 5.5 12 5.5c1.6 0 3 .4 4.2 1M21.5 12s-1.2 2.2-3.4 3.9" />
      <path d="M9.9 9.9a3.2 3.2 0 0 0 4.4 4.4" />
      <path d="M4 4l16 16" />
    </svg>
  );
}
