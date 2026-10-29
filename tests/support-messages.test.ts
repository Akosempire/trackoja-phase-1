// Support → Message the team: what the app may forward to the shared inbox.
import { describe, expect, it } from 'vitest';
import { displayName, parseSupportRequest } from '../supabase/functions/_shared/support';

const id = '6f1c2e7a-0000-4000-8000-000000000001';
describe('parseSupportRequest', () => {
  it('accepts the four actions', () => {
    expect(parseSupportRequest({ action: 'list' }).ok).toBe(true);
    expect(parseSupportRequest({ action: 'get', threadId: id }).ok).toBe(true);
    expect(parseSupportRequest({ action: 'reply', threadId: id, body: ' thanks ' })).toEqual({ ok: true, value: { action: 'reply', thread_id: id, body: 'thanks' } });
    const s = parseSupportRequest({ action: 'start', kind: 'feature', subject: '  Barcode   labels ', body: 'Please', storeId: id, page: '/support' });
    expect(s.ok && s.value).toMatchObject({ subject: 'Barcode labels', storeId: id });
  });
  it('refuses bad input', () => {
    expect(parseSupportRequest(null).ok).toBe(false);
    expect(parseSupportRequest({ action: 'delete' }).ok).toBe(false);
    expect(parseSupportRequest({ action: 'get', threadId: '../x' }).ok).toBe(false);
    expect(parseSupportRequest({ action: 'start', kind: 'spam', subject: 'abc', body: 'x' }).ok).toBe(false);
    expect(parseSupportRequest({ action: 'start', kind: 'feature', subject: 'ab', body: 'x' }).ok).toBe(false);
    expect(parseSupportRequest({ action: 'reply', threadId: id, body: '   ' }).ok).toBe(false);
  });
  it('never forwards another user id or a made-up store', () => {
    const s = parseSupportRequest({ action: 'start', kind: 'other', subject: 'Hello', body: 'x', user: { id: 'someone-else' }, storeId: 'not-a-uuid' });
    expect(s.ok && s.value).not.toHaveProperty('user');
    expect(s.ok && (s.value as { storeId: string | null }).storeId).toBeNull();
  });
});

describe('displayName', () => {
  it('uses the profile name, else the email', () => {
    expect(displayName('Ada', 'Obi', 'a@b.c')).toBe('Ada Obi');
    expect(displayName('', null, 'mama.nkechi@shop.ng')).toBe('mama.nkechi');
  });
});
