import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowRight01Icon, Cancel01Icon, Search01Icon } from '@hugeicons/core-free-icons';

export interface CommandSearchItem {
  id: string;
  label: string;
  description: string;
  group: string;
  to: string;
  keywords?: string[];
}

interface CommandSearchProps {
  items: CommandSearchItem[];
  label?: string;
}

export function CommandSearch({ items, label = 'Search' }: CommandSearchProps) {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return items;
    return items.filter((item) =>
      [item.label, item.description, item.group, ...(item.keywords ?? [])]
        .join(' ')
        .toLocaleLowerCase()
        .includes(needle)
    );
  }, [items, query]);

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    requestAnimationFrame(() => input.current?.focus());
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = overflow; };
  }, [open]);

  useEffect(() => setActive(0), [query]);

  function choose(item: CommandSearchItem) {
    setOpen(false);
    navigate(item.to);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') setOpen(false);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((value) => Math.min(value + 1, Math.max(results.length - 1, 0)));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((value) => Math.max(value - 1, 0));
    }
    if (event.key === 'Enter' && results[active]) choose(results[active]);
  }

  return (
    <>
      <button type="button" className="command-search-trigger" onClick={() => setOpen(true)} aria-label={label}>
        <HugeiconsIcon icon={Search01Icon} size={17} strokeWidth={1.7} aria-hidden />
        <span>{label}</span>
        <kbd>Ctrl K</kbd>
      </button>

      {open && (
        <div className="command-search-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <section className="command-search" role="dialog" aria-modal="true" aria-label="Search TrackOja" onKeyDown={onKeyDown}>
            <div className="command-search-field">
              <HugeiconsIcon icon={Search01Icon} size={19} strokeWidth={1.7} aria-hidden />
              <input
                ref={input}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search pages and actions…"
                role="combobox"
                aria-expanded="true"
                aria-controls="command-search-results"
                aria-activedescendant={results[active] ? `command-${results[active].id}` : undefined}
              />
              {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear search"><HugeiconsIcon icon={Cancel01Icon} size={17} aria-hidden /></button>}
              <button type="button" className="command-search-close" onClick={() => setOpen(false)} aria-label="Close search">Esc</button>
            </div>

            <div className="command-search-results" id="command-search-results" role="listbox">
              {results.length ? results.map((item, index) => (
                <button
                  key={item.id}
                  id={`command-${item.id}`}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  className={index === active ? 'is-active' : ''}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(item)}
                >
                  <span className="command-search-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
                  <span className="command-search-group">{item.group}</span>
                  <HugeiconsIcon icon={ArrowRight01Icon} size={17} strokeWidth={1.7} aria-hidden />
                </button>
              )) : (
                <div className="command-search-empty"><strong>No results</strong><span>Try a page name, task, or area.</span></div>
              )}
            </div>
            <footer className="command-search-footer"><span><kbd>↑↓</kbd> Navigate</span><span><kbd>↵</kbd> Open</span><span><kbd>Esc</kbd> Close</span></footer>
          </section>
        </div>
      )}
    </>
  );
}
