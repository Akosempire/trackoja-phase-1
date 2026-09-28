import { useSyncExternalStore } from 'react';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface InstallState {
  installed: boolean;
  canPrompt: boolean;
}

const listeners = new Set<() => void>();
let deferredPrompt: InstallPromptEvent | null = null;
let started = false;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

let state: InstallState = { installed: false, canPrompt: false };

export function getInstallState() {
  return state;
}

function update(next: InstallState) {
  state = next;
  listeners.forEach((listener) => listener());
}

/** Capture the browser's one-use prompt before any lazy route is rendered. */
export function initializeInstallApp() {
  if (started) return;
  started = true;
  update({ installed: isStandalone(), canPrompt: false });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    if (isStandalone()) return;
    deferredPrompt = event as InstallPromptEvent;
    update({ installed: false, canPrompt: true });
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    update({ installed: true, canPrompt: false });
  });

  const displayMode = window.matchMedia('(display-mode: standalone)');
  const onDisplayModeChange = () => {
    const installed = isStandalone();
    if (installed) deferredPrompt = null;
    update({ installed, canPrompt: !installed && deferredPrompt !== null });
  };
  displayMode.addEventListener?.('change', onDisplayModeChange);
}

export function useInstallApp() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getInstallState,
    getInstallState,
  );
}

/** A deferred prompt can be used only once, even if the user dismisses it. */
export async function requestAppInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const prompt = deferredPrompt;
  if (!prompt) return 'unavailable';
  deferredPrompt = null;
  update({ installed: false, canPrompt: false });
  try {
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') update({ installed: true, canPrompt: false });
    return outcome;
  } catch {
    return 'unavailable';
  }
}

export function isAppleMobileBrowser() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
