import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Button } from './ui/Button';
import { useToast } from './ui/Toast';
import { Card, CardHead, Pill, cn, inputClass } from './kit';
import { SUPPORT_KINDS, SUPPORT_STATUS, SupportNotConfigured, SupportService, type SupportKind, type SupportThread } from '../services/support.service';
import { formatRelative } from '../utils/format';

/**
 * Support → Message the team: a new message form and this person's
 * conversations. Replies arrive here (with a dot) and by email.
 */
export function SupportMessages({ fallbackEmail }: { fallbackEmail: string }) {
  const { profile } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [threads, setThreads] = useState<SupportThread[] | null>(null);
  const [off, setOff] = useState(false);
  const [kind, setKind] = useState<SupportKind>('feature');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    SupportService.list().then(setThreads).catch((e) => { if (e instanceof SupportNotConfigured) setOff(true); setThreads([]); });
  }, []);
  useEffect(load, [load]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSending(true); setError(null);
    try {
      const id = await SupportService.start({ kind, subject, body, page: '/support', storeId: profile?.currentStoreId ?? null });
      toast.success('Sent to the team', { description: "We'll reply here and by email." });
      navigate(`/support/messages/${id}`);
    } catch (err) {
      if (err instanceof SupportNotConfigured) setOff(true);
      setError(err instanceof Error ? err.message : 'Could not send. Try again.');
    } finally { setSending(false); }
  }

  if (off) {
    return (
      <Card className="mb-4 lg:mb-6">
        <CardHead title="Message the team" hint="Email us and we'll get back to you as soon as possible" />
        <a className="text-sm font-semibold text-brand-ink" href={`mailto:${fallbackEmail}`}>{fallbackEmail}</a>
      </Card>
    );
  }

  return (
    <>
      <Card className="mb-4 lg:mb-6">
        <CardHead title="Message the team" hint="Ask for a feature, report a problem or ask anything. It goes straight to the people who build TrackOja." />
        <form onSubmit={send} className="flex flex-col gap-4">
          {error && <p className="m-0 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">{error}</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="group" aria-label="What is it about?">
            {(Object.keys(SUPPORT_KINDS) as SupportKind[]).map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}
                className={cn('flex min-h-[60px] flex-col items-start justify-center rounded-lg border px-3 py-2 text-left transition-colors',
                  kind === k ? 'border-brand bg-brand-soft ring-1 ring-brand' : 'border-line-strong bg-surface hover:bg-subtle')}>
                <span className={cn('text-[13px] font-semibold', kind === k ? 'text-brand-ink' : 'text-ink')}>{SUPPORT_KINDS[k].verb}</span>
                <span className="mt-0.5 text-[11.5px] leading-4 text-ink-3">{SUPPORT_KINDS[k].hint}</span>
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Title
            <input className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)} required minLength={3} maxLength={140}
              placeholder={kind === 'feature' ? 'e.g. Print a barcode label for each product' : 'A few words'} />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-ink">Message
            <textarea className={cn(inputClass, 'h-auto min-h-[120px] py-2.5')} value={body} onChange={(e) => setBody(e.target.value)} required maxLength={5000}
              placeholder="Tell us what you need and how it would help your shop." />
          </label>
          <div className="flex justify-end"><Button type="submit" loading={sending} className="w-full sm:w-auto">Send to the team</Button></div>
        </form>
      </Card>

      {threads && threads.length > 0 && (
        <Card padded={false} className="mb-4 overflow-hidden lg:mb-6">
          <h2 className="m-0 px-4 pb-3 pt-4 text-[15px] font-semibold text-ink sm:px-5">Your conversations</h2>
          <ul className="m-0 list-none divide-y divide-line border-t border-line p-0">
            {threads.map((t) => (
              <li key={t.id}>
                <Link to={`/support/messages/${t.id}`} className="flex items-center gap-3 px-4 py-3 text-inherit no-underline hover:bg-subtle sm:px-5">
                  <span className="min-w-0 flex-1">
                    <span className={cn('flex items-center gap-2 truncate text-sm text-ink', t.unread ? 'font-semibold' : 'font-medium')}>
                      {t.unread && <span className="size-2 shrink-0 rounded-full bg-brand" aria-label="New reply" />}{t.subject}
                    </span>
                    <span className="mt-0.5 block text-[12.5px] text-ink-3">{SUPPORT_KINDS[t.kind]?.label} · {formatRelative(t.last_message_at)}</span>
                  </span>
                  <Pill tone={SUPPORT_STATUS[t.status]?.tone}>{SUPPORT_STATUS[t.status]?.label}</Pill>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
