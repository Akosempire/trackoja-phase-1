import { ImportPreview } from '../../src/components/ImportPreview';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../../src/components/ui/Button';
import { SearchInput } from '../../src/components/ui/SearchInput';
import { FormField } from '../../src/components/ui/FormField';
import { DataTable } from '../../src/components/ui/DataTable';
import { SegmentedControl } from '../../src/components/ui/SegmentedControl';
import { Dialog } from '../../src/components/ui/Dialog';
import { Drawer } from '../../src/components/ui/Drawer';
import { StateBlock } from '../../src/components/ui/StateBlock';
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

function Foundation() {
  const [state, setState] = useState('populated');
  const [open, setOpen] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [email, setEmail] = useState('');
  return <main className="page plat-page is-wide">
    <header className="plat-page-head"><h1 className="plat-page-title">Billing</h1><div className="plat-page-actions">
      <Button variant="outline" onClick={() => setDrawer(true)}>Open navigation</Button>
      <Button onClick={() => setOpen(true)}>Edit contact</Button>
    </div></header>
    <SegmentedControl label="Data state" value={state} onChange={setState} options={['populated', 'empty', 'loading', 'error'].map((value) => ({ value, label: value }))} />
    <div className="control-row search-input-row"><div><SearchInput aria-label="Search transactions" placeholder="Search transactions" /></div><Button variant="outline">Search</Button></div>
    {state === 'error' ? <StateBlock variant="error" title="Transactions could not load" actions={<Button onClick={() => setState('populated')}>Retry</Button>} /> :
      <DataTable caption="Transactions" stacked loading={state === 'loading'} rows={state === 'empty' ? [] : [{ id: 'TRK-123', amount: '₦22,500' }]}
        columns={[{ key: 'id', header: 'Reference', label: '', render: (row) => row.id }, { key: 'amount', header: 'Amount', numeric: true, render: (row) => row.amount }]}
        rowKey={(row) => row.id} empty={<StateBlock title="No payments yet" body="Verified payments will appear here." />} />}
    <section className="card"><h2 className="section-title">Product import</h2><ImportPreview rows={[
      { rowNumber: 2, name: 'A product with a deliberately long name for a narrow screen', sku: 'LONGREFERENCEWITHOUTSPACES012345678901234567890123456789', unit: 'kg', costPrice: 120, sellingPrice: 22500, taxRate: 0, trackInventory: true, stockQty: 4.5, reorderLevel: 1, errors: [] },
      { rowNumber: 3, name: '', sku: '', unit: 'unit', costPrice: 0, sellingPrice: 0, taxRate: 0, trackInventory: false, stockQty: 0, reorderLevel: 0, errors: ['Name is required', 'SKU is required'] },
    ]} /></section>
    <Dialog open={open} onClose={() => setOpen(false)} title="Billing contact" footer={<Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>}>
      <FormField id="contact" label="Billing email" type="email" value={email} onChange={setEmail} hint="Used for receipts." />
    </Dialog>
    <Drawer open={drawer} onClose={() => setDrawer(false)} label="Navigation">
      <Button onClick={() => setDrawer(false)}>Close navigation</Button><a href="#billing">Billing</a>
    </Drawer>
    {/* Restricted-role geometry: only one permitted destination, still centre Scan. */}
    <nav className="bottom-nav" aria-label="Mobile geometry">
      <a className="bottom-nav-link bottom-nav-slot-1" href="#overview"><span className="bottom-nav-label">Overview</span></a>
      <button className="bottom-nav-scan" aria-label="Scan"><span className="bottom-nav-scan-face">+</span><span className="bottom-nav-label">Scan</span></button>
    </nav>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Foundation />);
