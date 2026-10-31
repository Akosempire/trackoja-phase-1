import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from './ui/Button';
import { useToast } from './ui/Toast';
import { Card, CardHead, cn, inputClass } from './kit';
import { AccountService, type BusinessDeletion } from '../services/account.service';
import { AuthService } from '../services/auth.service';
import { exportFileName, exportSheets } from '../utils/exportSheets';
import { formatDateTime } from '../utils/format';

/** Settings → Daily email: yesterday's sales and low stock, each morning. */
export function DailyEmailCard({ storeId, canUpdate }: { storeId: string; canUpdate: boolean }) {
  const toast = useToast();
  const [on, setOn] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { AccountService.getDailyEmail(storeId).then(setOn).catch(() => setOn(null)); }, [storeId]);
  if (on === null) return null;
  const toggle = async () => {
    setSaving(true);
    try { const v = await AccountService.setDailyEmail(storeId, !on); setOn(v); toast.success(v ? 'Daily email on' : 'Daily email off'); }
    catch (e) { toast.error('Not changed', { description: e instanceof Error ? e.message : 'Try again.' }); }
    finally { setSaving(false); }
  };
  return (
    <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 className="m-0 text-[15px] font-semibold text-ink">Daily email</h2>
        <p className="m-0 mt-0.5 text-[13px] text-ink-3">Each morning, owners and managers get yesterday's sales and anything running low.</p>
      </div>
      <button type="button" role="switch" aria-checked={on} aria-label="Daily email" disabled={!canUpdate || saving} onClick={toggle}
        className={cn('relative inline-flex h-7 w-12 shrink-0 items-center self-start rounded-full transition-colors disabled:opacity-50 sm:self-auto', on ? 'bg-brand' : 'bg-line-strong')}>
        <span className={cn('inline-block size-5 rounded-full bg-white shadow transition-transform', on ? 'translate-x-6' : 'translate-x-1')} />
      </button>
    </Card>
  );
}

/** Settings → Privacy & data: download, delete business, delete account. */
export function PrivacyDataCard({ storeId, storeName, orgId, canExport }: { storeId: string; storeName: string; orgId: string | null | undefined; canExport: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState<'export' | 'delete' | 'cancel' | 'account' | null>(null);
  const [deletion, setDeletion] = useState<BusinessDeletion | null>(null);
  const [confirmBiz, setConfirmBiz] = useState<string | null>(null);
  const [confirmMe, setConfirmMe] = useState<string | null>(null);

  const load = useCallback(() => { if (orgId) AccountService.getDeletion(orgId).then(setDeletion).catch(() => setDeletion(null)); }, [orgId]);
  useEffect(load, [load]);

  async function download() {
    setBusy('export');
    try {
      const data = await AccountService.exportStoreData(storeId);
      const XLSX = await import('xlsx');
      const book = XLSX.utils.book_new();
      for (const sheet of exportSheets(data)) XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(sheet.rows.length ? sheet.rows : [{ note: 'Nothing recorded yet' }]), sheet.name);
      XLSX.writeFile(book, exportFileName(storeName));
      toast.success('Downloaded', { description: 'An Excel file with a sheet for each kind of record.' });
    } catch (e) {
      toast.error('Download failed', { description: e instanceof Error ? e.message : 'Try again.' });
    } finally { setBusy(null); }
  }

  async function scheduleDelete() {
    if (!orgId || confirmBiz === null) return;
    setBusy('delete');
    try { await AccountService.requestDeletion(orgId, confirmBiz); setConfirmBiz(null); load(); toast.warning('Business will be deleted in 30 days', { description: 'You can cancel until then.' }); }
    catch (e) { toast.error('Not scheduled', { description: e instanceof Error ? e.message : 'Try again.' }); }
    finally { setBusy(null); }
  }
  async function cancelDelete() {
    if (!orgId) return;
    setBusy('cancel');
    try { await AccountService.cancelDeletion(orgId); load(); toast.success('Deletion cancelled', { description: 'Nothing will be deleted.' }); }
    catch (e) { toast.error('Not cancelled', { description: e instanceof Error ? e.message : 'Try again.' }); }
    finally { setBusy(null); }
  }
  async function deleteMe() {
    setBusy('account');
    try { await AccountService.deleteAccount(); await AuthService.logout().catch(() => undefined); window.location.assign('/'); }
    catch (e) { toast.error('Account not deleted', { description: e instanceof Error ? e.message : 'Try again.' }); setBusy(null); }
  }

  const owner = Boolean(deletion?.owner);
  const bizName = deletion?.name ?? '';
  return (
    <Card aria-labelledby="privacy-title">
      <CardHead title={<span id="privacy-title">Privacy &amp; data</span>} hint={<>Your data, your choice. See our <Link className="text-brand-ink" to="/privacy">privacy policy</Link>.</>} />
      <div className="flex flex-col divide-y divide-line">
        {canExport && (
          <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="m-0 text-sm font-semibold text-ink">Download this store's data</p>
              <p className="m-0 mt-0.5 text-[13px] text-ink-3">Products, sales, customers, expenses and stock history, as an Excel file.</p>
            </div>
            <Button variant="outline" onClick={download} loading={busy === 'export'} disabled={busy !== null} className="shrink-0 self-start sm:self-auto">Download</Button>
          </div>
        )}

        {owner && (
          <div className="flex flex-col gap-3 py-4">
            <div>
              <p className="m-0 text-sm font-semibold text-ink">Delete business</p>
              {deletion?.due_at ? (
                <p className="m-0 mt-0.5 text-[13px] text-danger" role="status">{bizName} and everything in it will be deleted on {formatDateTime(deletion.due_at)}.</p>
              ) : (
                <p className="m-0 mt-0.5 text-[13px] text-ink-3">Removes {bizName || 'the business'}, all its branches and records, for everyone. You have 30 days to change your mind.</p>
              )}
            </div>
            {deletion?.due_at ? (
              <Button variant="outline" onClick={cancelDelete} loading={busy === 'cancel'} disabled={busy !== null} className="self-start">Cancel deletion</Button>
            ) : confirmBiz === null ? (
              <Button variant="danger" onClick={() => setConfirmBiz('')} disabled={busy !== null} className="self-start">Delete business…</Button>
            ) : (
              <div className="flex flex-col gap-2">
                <label className="text-[13px] text-ink-2" htmlFor="confirm-biz">Type <strong className="text-ink">{bizName}</strong> to confirm</label>
                <input id="confirm-biz" className={inputClass} value={confirmBiz} onChange={(e) => setConfirmBiz(e.target.value)} autoComplete="off" />
                <div className="flex flex-wrap gap-2">
                  <Button variant="danger" onClick={scheduleDelete} loading={busy === 'delete'} disabled={busy !== null || confirmBiz.trim().toLowerCase() !== bizName.trim().toLowerCase()}>Delete in 30 days</Button>
                  <Button variant="ghost" onClick={() => setConfirmBiz(null)}>Keep it</Button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-col gap-3 pt-4">
          <div>
            <p className="m-0 text-sm font-semibold text-ink">Delete my account</p>
            <p className="m-0 mt-0.5 text-[13px] text-ink-3">
              {owner ? 'You own this business. Delete it first (or hand it to someone else), then you can delete your account.' : 'Removes your login and personal details. Sales you rang up stay with the business, without your name.'}
            </p>
          </div>
          {!owner && (confirmMe === null ? (
            <Button variant="danger" onClick={() => setConfirmMe('')} disabled={busy !== null} className="self-start">Delete my account…</Button>
          ) : (
            <div className="flex flex-col gap-2">
              <label className="text-[13px] text-ink-2" htmlFor="confirm-me">Type <strong className="text-ink">DELETE</strong> to confirm. This can't be undone.</label>
              <input id="confirm-me" className={inputClass} value={confirmMe} onChange={(e) => setConfirmMe(e.target.value)} autoComplete="off" />
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" onClick={deleteMe} loading={busy === 'account'} disabled={busy !== null || confirmMe.trim().toUpperCase() !== 'DELETE'}>Delete my account</Button>
                <Button variant="ghost" onClick={() => setConfirmMe(null)}>Cancel</Button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
