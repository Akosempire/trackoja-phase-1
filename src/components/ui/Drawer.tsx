import { useEffect, useRef, type ReactNode } from 'react';
import { containDialogFocus } from '../../utils/dialog-focus';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  id?: string;
  label: string;
  side?: 'start' | 'end';
  closeAtDesktop?: boolean;
  children: ReactNode;
}

/**
 * Shared modal side sheet for compact navigation and contextual workflows.
 * Native dialog supplies modality and focus restoration; TrackOja adds focus
 * containment, backdrop dismissal, scroll locking and responsive cleanup.
 */
export function Drawer({
  open,
  onClose,
  id,
  label,
  side = 'start',
  closeAtDesktop = false,
  children,
}: DrawerProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const drawer = ref.current;
    if (!drawer) return;

    if (open && !drawer.open) drawer.showModal();
    if (!open && drawer.open) drawer.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const desktop = closeAtDesktop
      ? window.matchMedia('(min-width: 901px)')
      : null;
    const closeForDesktop = () => {
      if (desktop?.matches) onClose();
    };
    desktop?.addEventListener('change', closeForDesktop);

    return () => {
      document.body.style.overflow = previousOverflow;
      desktop?.removeEventListener('change', closeForDesktop);
    };
  }, [closeAtDesktop, onClose, open]);

  return (
    <dialog
      ref={ref}
      id={id}
      className={`drawer drawer-${side}`}
      aria-label={label}
      onKeyDown={containDialogFocus}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="drawer-panel">{children}</div>
    </dialog>
  );
}
