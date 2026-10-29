import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { PageLoader } from '../../components/ui/PageLoader';
import { StateBlock } from '../../components/ui/StateBlock';
import { useToast } from '../../components/ui/Toast';
import { Card, Page, PageHeader, Pill, btn, cn, inputClass } from '../../components/kit';
import { SUPPORT_KINDS, SUPPORT_STATUS, SupportService, type SupportMessage, type SupportThread } from '../../services/support.service';
import { formatDateTime } from '../../utils/format';

/** /support/messages/:id: one conversation with the team. Opening it marks replies read. */
export default function SupportThreadPage() {
  const { threadId = '' } = useParams();
  const toast = useToast();
  const [data, setData] = useState<{ thread: SupportThread; messages: SupportMessage[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const load = useCallback(() => {
    SupportService.get(threadId).then(setData).catch((e) => setError(e instanceof Error ? e.message : 'Could not load this conversation'));
  }, [threadId]);
  useEffect(load, [load]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      await SupportService.reply(threadId, reply);
      setReply('');
      toast.success('Sent', { description: "We'll email you when we reply." });
      load();
    } catch (err) {
      toast.error('Not sent', { description: err instanceof Error ? err.message : 'Try again.' });
    } finally { setSending(false); }
  }

  if (error) return <Page width="form"><Card><StateBlock variant="error" title="Conversation not found" body={error} actions={<Link className={btn('outline')} to="/support">Back to support</Link>} /></Card></Page>;
  if (!data) return <PageLoader />;
  const { thread, messages } = data;
  return (
    <Page width="form">
      <PageHeader eyebrow={SUPPORT_KINDS[thread.kind]?.label} title={thread.subject}
        actions={<><Pill tone={SUPPORT_STATUS[thread.status]?.tone}>{SUPPORT_STATUS[thread.status]?.label}</Pill><Link className={btn('outline', 'sm')} to="/support">All messages</Link></>} />
      <Card padded={false} className="overflow-hidden">
        <ol className="m-0 flex list-none flex-col gap-3 p-4 sm:p-5">
          {messages.map((m) => (
            <li key={m.id} className={cn('flex flex-col gap-1', m.from_team ? 'items-start' : 'items-end')}>
              <span className="text-[11.5px] text-ink-3">{m.from_team ? 'TrackOja team' : 'You'} · {formatDateTime(m.created_at)}</span>
              <div className={cn('max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-6',
                m.from_team ? 'rounded-tl-md bg-tray text-ink' : 'rounded-tr-md bg-brand text-white')}>{m.body}</div>
            </li>
          ))}
        </ol>
        <form onSubmit={send} className="flex flex-col gap-3 border-t border-line p-4 sm:p-5">
          <textarea className={cn(inputClass, 'h-auto min-h-[96px] py-2.5')} value={reply} onChange={(e) => setReply(e.target.value)} required maxLength={5000}
            aria-label="Your reply" placeholder="Add more detail or reply to the team…" />
          <div className="flex justify-end"><Button type="submit" loading={sending} className="w-full sm:w-auto">Send</Button></div>
        </form>
      </Card>
    </Page>
  );
}
