import { useRef, useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ViewIcon, ViewOffSlashIcon } from '@hugeicons/core-free-icons';

interface FormFieldProps {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  error?: string;
  /** Guidance shown below the control. Replaced by the error when one is present. */
  hint?: string;
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
  hint,
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
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
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
            <HugeiconsIcon icon={revealed ? ViewOffSlashIcon : ViewIcon} size={18} strokeWidth={1.7} aria-hidden />
          </button>
        )}
      </div>

      {error && <span className="form-error" id={`${id}-error`} role="alert">{error}</span>}
      {!error && hint && <span className="form-hint" id={`${id}-hint`}>{hint}</span>}
    </div>
  );
}

