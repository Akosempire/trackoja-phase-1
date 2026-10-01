import { Component, type ReactNode } from 'react';
export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <main className="startup-screen" role="alert"><strong>TrackOja could not open this page</strong><p>Check your connection, then try again. Your current address will be kept.</p><button className="btn btn-primary" onClick={() => window.location.reload()}>Retry</button></main>;
    return this.props.children;
  }
}
