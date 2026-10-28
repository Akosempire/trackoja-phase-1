import { APP_NAME } from '../config/brand';
import { Component, type ReactNode } from 'react';
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-canvas p-6 text-center" role="alert"><strong className="text-[17px] font-semibold text-ink">{APP_NAME} could not open this page</strong><p className="m-0 max-w-sm text-sm text-ink-2">Check your connection, then try again. Your current address will be kept.</p><button className="mt-3 h-10 rounded-md bg-brand px-4 text-sm font-semibold text-white" onClick={() => window.location.reload()}>Retry</button></main>;
    return this.props.children;
  }
}
