import { useState, type ReactNode } from 'react';
import { isAppleMobileBrowser, requestAppInstall, useInstallApp } from '../pwa-install';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { useToast } from './ui/Toast';

interface InstallAppActionProps {
  className?: string;
  label?: string;
  labelClassName?: string;
  icon?: ReactNode;
  trailing?: ReactNode;
}

export function InstallAppAction({
  className = 'btn btn-outline',
  label = 'Install app',
  labelClassName,
  icon,
  trailing,
}: InstallAppActionProps) {
  const { installed, canPrompt } = useInstallApp();
  const toast = useToast();
  const [showGuide, setShowGuide] = useState(false);
  const [busy, setBusy] = useState(false);
  const appleMobile = isAppleMobileBrowser();

  if (installed) return null;

  async function handleClick() {
    if (!canPrompt) {
      setShowGuide(true);
      return;
    }
    setBusy(true);
    const outcome = await requestAppInstall();
    setBusy(false);
    if (outcome === 'accepted') toast.success('TrackOja installation started.');
    if (outcome === 'unavailable') setShowGuide(true);
  }

  return (
    <>
      <button type="button" className={`${className} install-app-action`} onClick={() => void handleClick()} disabled={busy}>
        <span className="install-app-action-main">
          {icon}
          <span className={labelClassName}>{label}</span>
        </span>
        {trailing}
      </button>
      <Dialog
        open={showGuide}
        onClose={() => setShowGuide(false)}
        title="Install TrackOja"
        description="Open TrackOja from your home screen or desktop app list."
        footer={<Button variant="outline" onClick={() => setShowGuide(false)}>Done</Button>}
      >
        {appleMobile ? (
          <ol className="install-app-steps">
            <li>Open this page in Safari.</li>
            <li>Tap Share, then choose <strong>Add to Home Screen</strong>.</li>
            <li>Tap Add. TrackOja will appear on your Home Screen.</li>
          </ol>
        ) : (
          <ol className="install-app-steps">
            <li>Open your browser menu, or look for the install icon in the address bar.</li>
            <li>Choose <strong>Install TrackOja</strong> or <strong>Add to Home screen</strong>.</li>
            <li>Confirm to add TrackOja to your device.</li>
          </ol>
        )}
        <p className="install-app-note">Installation requires a browser that supports web apps and a secure connection.</p>
      </Dialog>
    </>
  );
}
