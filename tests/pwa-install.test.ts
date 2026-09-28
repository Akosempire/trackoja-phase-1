// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { getInstallState, initializeInstallApp, requestAppInstall } from '../src/pwa-install';

describe('PWA installation', () => {
  it('uses the browser prompt once and hides install actions after installation', async () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
    }));

    initializeInstallApp();
    expect(getInstallState()).toEqual({ installed: false, canPrompt: false });
    expect(await requestAppInstall()).toBe('unavailable');

    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(getInstallState().canPrompt).toBe(true);
    expect(await requestAppInstall()).toBe('accepted');
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(getInstallState().installed).toBe(true);
    expect(await requestAppInstall()).toBe('unavailable');

    window.dispatchEvent(new Event('appinstalled'));
    expect(getInstallState()).toEqual({ installed: true, canPrompt: false });
    vi.unstubAllGlobals();
  });
});
