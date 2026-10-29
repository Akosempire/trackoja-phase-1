// "Message the team": TrackOja passes its signed-in user's messages to
// Usetally's shared inbox (POST <USETALLY_URL>/api/support/trackoja) with the
// shared secret USETALLY_SUPPORT_SECRET. Pure helpers, tested in tests/support-messages.test.ts.

export const KINDS = ['feature', 'problem', 'question', 'other'] as const;
export type Kind = (typeof KINDS)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean = (v: unknown, max: number) => String(v ?? '').replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max);

export type SupportRequest =
  | { action: 'list' }
  | { action: 'get'; thread_id: string }
  | { action: 'start'; kind: Kind; subject: string; body: string; page: string; storeId: string | null }
  | { action: 'reply'; thread_id: string; body: string };

/** What the app sent → a request to forward, or an error to show. */
export function parseSupportRequest(b: Record<string, unknown> | null): { ok: true; value: SupportRequest } | { ok: false; error: string } {
  const action = b?.action;
  if (action === 'list') return { ok: true, value: { action } };
  if (action === 'get') {
    return UUID.test(String(b?.threadId ?? '')) ? { ok: true, value: { action, thread_id: String(b!.threadId) } } : { ok: false, error: 'Conversation not found' };
  }
  if (action === 'start') {
    const kind = String(b?.kind ?? '') as Kind;
    if (!KINDS.includes(kind)) return { ok: false, error: "Choose what it's about" };
    const subject = clean(b?.subject, 140).replace(/\s+/g, ' ');
    if (subject.length < 3) return { ok: false, error: 'Add a short title (at least 3 characters)' };
    const body = clean(b?.body, 5000);
    if (!body) return { ok: false, error: 'Write your message' };
    const storeId = UUID.test(String(b?.storeId ?? '')) ? String(b!.storeId) : null;
    return { ok: true, value: { action, kind, subject, body, page: clean(b?.page, 200).replace(/\s+/g, ''), storeId } };
  }
  if (action === 'reply') {
    if (!UUID.test(String(b?.threadId ?? ''))) return { ok: false, error: 'Conversation not found' };
    const body = clean(b?.body, 5000);
    return body ? { ok: true, value: { action, thread_id: String(b!.threadId), body } } : { ok: false, error: 'Write your message' };
  }
  return { ok: false, error: 'Unknown action' };
}

export function displayName(first: unknown, last: unknown, email: string): string {
  const n = [first, last].map((x) => String(x ?? '').trim()).filter(Boolean).join(' ');
  return n || email.split('@')[0] || 'TrackOja user';
}
