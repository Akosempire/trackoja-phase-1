import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import '@fontsource-variable/figtree';
import './styles/index.css';
import { ToastProvider } from './components/ui/Toast';
import { applyTheme, readTheme } from './components/ThemeSelect';
import { registerAppWorker } from './pwa';
import { initializeInstallApp } from './pwa-install';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { AppUpdateBanner } from './components/AppUpdateBanner';

applyTheme(readTheme());
initializeInstallApp();
registerAppWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
    <AppUpdateBanner />
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>
);
