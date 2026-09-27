import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import './styles/theme.css';
import './styles/auth.css';
import './styles/app.css';
import '@fontsource-variable/geist';
import '@fontsource/playfair-display/latin-400.css';
import './styles/tokens.css';
import './styles/waya.css';
import './styles/toast.css';
import './styles/bottom-nav.css';
import './styles/form-controls.css';
import './styles/mobile.css';
import { ToastProvider } from './components/ui/Toast';
import { applyTheme, readTheme } from './components/ThemeSelect';

applyTheme(readTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>
);
