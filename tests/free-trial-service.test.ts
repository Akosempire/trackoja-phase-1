import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionService } from '../src/services/subscription.service';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }));
vi.mock('../src/config/supabase', () => ({ supabase: { rpc: mocks.rpc, functions: { invoke: mocks.invoke } } }));
beforeEach(() => { vi.resetAllMocks(); });

describe('subscription payment availability', () => {
  it.each(['DISABLED', 'TEST', 'UNKNOWN'])('stops merchant checkout before payment creation in %s mode', async (mode) => {
    mocks.rpc.mockResolvedValue({ data: { payment_system: mode, trial_enabled: true, trial_days: 14 }, error: null });
    await expect(SubscriptionService.startPlanCheckout('version', 'https://example.com/billing')).rejects.toThrow();
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('get_billing_availability');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('uses only the trial RPC for activation', async () => {
    mocks.rpc.mockResolvedValue({ data: { plan_name: 'Starter', trial_ends_at: '2026-10-13', trial_days: 14 }, error: null });
    expect(await SubscriptionService.startTrial('version')).toEqual({ planName: 'Starter', trialEndsAt: '2026-10-13', trialDays: 14 });
    expect(mocks.rpc).toHaveBeenCalledWith('start_product_trial', { p_plan_version_id: 'version' });
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('translates raw Edge Function failures', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error('Edge Function returned a non-2xx status code') });
    await expect(SubscriptionService.verifyPayment('reference')).rejects.toThrow('We could not confirm your payment yet');
  });
});
