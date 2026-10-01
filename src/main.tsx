import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import './styles/theme.css';
import './styles/auth.css';
import './styles/app.css';
import '@fontsource-variable/inter';
import '@fontsource/forum/latin-400.css';
import './styles/tokens.css';
import './styles/waya.css';
import './styles/waya-components.css';
import './styles/toast.css';
import './styles/command-search.css';
import './styles/bottom-nav.css';
import './styles/form-controls.css';
import './styles/mobile.css';
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
