import { supabase } from '../config/supabase';

/**
 * "Message the team" (Support). Goes through the support-messages Edge Function
 * to the shared Usetally inbox; replies come back here and by email.
 */
export type SupportKind = 'feature' | 'problem' | 'question' | 'other';
export interface SupportThread { id: string; kind: SupportKind; subject: string; status: 'open' | 'planned' | 'done' | 'closed'; unread?: boolean; last_message_at?: string; created_at?: string }
export interface SupportMessage { id: string; body: string; from_team: boolean; created_at: string }

export const SUPPORT_KINDS: Record<SupportKind, { label: string; verb: string; hint: string }> = {
  feature: { label: 'Feature idea', verb: 'Request a feature', hint: 'Something you wish TrackOja did' },
  problem: { label: 'Problem', verb: 'Report a problem', hint: "Something isn't working" },
  question: { label: 'Question', verb: 'Ask a question', hint: 'How to do something' },
  other: { label: 'Other', verb: 'Something else', hint: 'Anything else' },
};
export const SUPPORT_STATUS: Record<SupportThread['status'], { label: string; tone: 'brand' | 'success' | 'neutral' | 'warn' }> = {
  open: { label: 'Open', tone: 'brand' },
  planned: { label: 'Planned', tone: 'warn' },
  done: { label: 'Done', tone: 'success' },
  closed: { label: 'Closed', tone: 'neutral' },
};

export class SupportNotConfigured extends Error {}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('support-messages', { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    let payload: { error?: string; notConfigured?: boolean } | null = null;
    try { payload = context?.json ? await context.json() : null; } catch { payload = null; }
    if (payload?.notConfigured || context?.status === 404) throw new SupportNotConfigured(payload?.error || 'Messaging the team is not switched on yet.');
    throw new Error(payload?.error || 'Something went wrong. Try again.');
  }
  return data as T;
}

export class SupportService {
  static async list(): Promise<SupportThread[]> {
    return (await call<{ threads: SupportThread[] }>({ action: 'list' })).threads ?? [];
  }
  static async get(threadId: string): Promise<{ thread: SupportThread; messages: SupportMessage[] }> {
    return call({ action: 'get', threadId });
  }
  static async start(input: { kind: SupportKind; subject: string; body: string; page?: string; storeId?: string | null }): Promise<string> {
    return (await call<{ id: string }>({ action: 'start', ...input })).id;
  }
  static async reply(threadId: string, body: string): Promise<void> {
    await call({ action: 'reply', threadId, body });
  }
}
