import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BarcodeScanner } from '../../src/components/BarcodeScanner';
import { InstallAppAction } from '../../src/components/InstallAppAction';
import { initializeInstallApp } from '../../src/pwa-install';
import { ToastProvider } from '../../src/components/ui/Toast';
import { FormField } from '../../src/components/ui/FormField';
import { Button } from '../../src/components/ui/Button';
import '../../src/styles/theme.css';
import '../../src/styles/app.css';
import '@fontsource-variable/inter';
import '@fontsource/forum/latin-400.css';
import '../../src/styles/tokens.css';
import '../../src/styles/waya.css';
import '../../src/styles/waya-components.css';
import '../../src/styles/bottom-nav.css';
import '../../src/styles/form-controls.css';
import '../../src/styles/mobile.css';
initializeInstallApp();
function Compatibility() {
  const [scan, setScan] = useState(false);
  const [code, setCode] = useState('');
  const [amount, setAmount] = useState('');
  return <main className="page page-form">
    <h1 className="page-title">Browser checks</h1>
    <div className="btn-row"><InstallAppAction /><Button onClick={() => setScan(true)}>Open scanner</Button></div>
    <form onSubmit={event => event.preventDefault()}><FormField id="amount" label="Amount" type="number" min={0} step="any" value={amount} onChange={setAmount} /><Button type="submit">Validate amount</Button></form>
    <output aria-label="Detected barcode">{code}</output>
    {scan && <BarcodeScanner onClose={() => setScan(false)} onDetect={value => { setCode(value); setScan(false); }} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<ToastProvider><Compatibility /></ToastProvider>);
