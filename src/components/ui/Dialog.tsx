import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { containDialogFocus } from '../../utils/dialog-focus';
import { Button } from './Button';
import { FormField } from './FormField';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  danger?: boolean;
}

/**
 * Native `<dialog>` wrapper, matching the scanner and mobile-nav precedent:
 * focus containment, Escape, backdrop dismissal and focus restoration come from
 * the platform rather than being re-implemented per screen.
 */
export function Dialog({ open, onClose, title, description, children, footer, wide, danger }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const classes = ['dialog', wide ? 'is-wide' : '', danger ? 'dialog-danger' : ''].filter(Boolean).join(' ');

  return (
    <dialog
      ref={ref}
      className={classes}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={containDialogFocus}
      onClick={(event) => {
        // The dialog element fills its own box, so a click on the element itself
        // (rather than on its content) is a backdrop click.
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="dialog-form">
        <div className="dialog-head">
          <div className="dialog-head-text">
            <h2 className="dialog-title" id={titleId}>{title}</h2>
            {description && (
              <p className="dialog-sub" id={descriptionId}>{description}</p>
            )}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>
        {children && <div className="dialog-body">{children}</div>}
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </dialog>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void> | void;
  title: string;
  /** What is about to happen, stated plainly, including what it affects. */
  consequence: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** High-impact actions require a reason, which is written to the audit trail. */
  requireReason?: boolean;
  reasonLabel?: string;
  reasonHint?: string;
}

/**
 * Confirmation for destructive or financially consequential actions only.
 * Routine work is deliberately not gated behind one.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  consequence,
  confirmLabel,
  danger,
  requireReason,
  reasonLabel = 'Reason',
  reasonHint,
}: ConfirmDialogProps) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  async function confirm() {
    if (requireReason && reason.trim().length < 3) {
      setError('Give a short reason so the audit trail explains this change.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      danger={danger}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={confirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={danger ? 'callout callout-danger' : 'callout callout-info'}>
        <div>
          <p className="callout-title">What this does</p>
          <p className="callout-text">{consequence}</p>
        </div>
      </div>

      {requireReason && (
        <FormField
          id="confirm-reason"
          label={reasonLabel}
          value={reason}
          onChange={setReason}
          placeholder="Shown in the audit trail"
          error={error ?? undefined}
          disabled={busy}
        />
      )}

      {!requireReason && reasonHint && <p className="form-hint">{reasonHint}</p>}
    </Dialog>
  );
}
