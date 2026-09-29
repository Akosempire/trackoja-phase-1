import type { InputHTMLAttributes } from 'react';

type SearchInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  'aria-label': string;
};

/** The same token-backed search field for merchant and platform directories. */
export function SearchInput({ className, ...props }: SearchInputProps) {
  return <input type="search" className={['form-input', 'search-input', className].filter(Boolean).join(' ')} {...props} />;
}
