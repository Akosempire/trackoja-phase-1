import { APP_MARK, APP_NAME } from '../config/brand';

export function StartupScreen() {
  return <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-canvas px-4 text-center" role="status" aria-live="polite" aria-busy="true">
    <span aria-hidden="true" className="inline-flex size-12 animate-pulse items-center justify-center rounded-xl bg-brand text-[22px] font-bold text-white">{APP_MARK}</span>
    <div>
      <strong className="block text-[17px] font-semibold text-ink">{APP_NAME}</strong>
      <p className="m-0 mt-1 text-sm text-ink-3">Opening your workspace…</p>
    </div>
  </main>;
}
