// tests/store-switching.test.ts
// Verify store switching functionality

import { StoreContextManager } from '../src/utils/store-context';
import { StoreService } from '../src/services/store.service';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('Store Switching', () => {
  let store1: any, store2: any;
  let userId = 'test-user-id';

  beforeEach(() => {
    // Clear context before each test
    StoreContextManager.clearContext();
    localStorage.clear();
  });

  it('Should set store context', () => {
    const store = {
      id: 'store-1',
      orgId: 'org-1',
      name: 'Test Store 1',
      slug: 'test-store-1',
    };

    StoreContextManager.switchStore(store as any, userId);
    const context = StoreContextManager.getContext();

    expect(context?.storeId).toBe('store-1');
    expect(context?.orgId).toBe('org-1');
    expect(context?.userId).toBe(userId);
  });

  it('Should persist context in localStorage', () => {
    const store = {
      id: 'store-2',
      orgId: 'org-1',
      name: 'Test Store 2',
    };

    StoreContextManager.switchStore(store as any, userId);

    const stored = localStorage.getItem('trackoja_store_context');
    expect(stored).not.toBeNull();

    const parsed = JSON.parse(stored!);
    expect(parsed.storeId).toBe('store-2');
  });

  it('Should dispatch context change event', async () => {
    const store = {
      id: 'store-3',
      orgId: 'org-1',
      name: 'Test Store 3',
    };

    let eventFired = false;
    let eventContext: any = null;

    const unsubscribe = StoreContextManager.onContextChange((context) => {
      eventFired = true;
      eventContext = context;
    });

    StoreContextManager.switchStore(store as any, userId);

    // Wait for event
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(eventFired).toBe(true);
    expect(eventContext?.storeId).toBe('store-3');

    unsubscribe();
  });

  it('Should clear context', () => {
    const store = {
      id: 'store-4',
      orgId: 'org-1',
      name: 'Test Store 4',
    };

    StoreContextManager.switchStore(store as any, userId);
    expect(StoreContextManager.getContext()).not.toBeNull();

    StoreContextManager.clearContext();
    expect(StoreContextManager.getContext()).toBeNull();
  });

  afterEach(() => {
    localStorage.clear();
  });
});
