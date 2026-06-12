// utils/store-context.ts
// Store context management for persistent store selection

import type { Store, StoreContext } from '../types';

const STORE_CONTEXT_KEY = 'trackoja_store_context';

export class StoreContextManager {
  /**
   * Get the current store context
   */
  static getContext(): StoreContext | null {
    try {
      const stored = localStorage.getItem(STORE_CONTEXT_KEY);
      return stored ? JSON.parse(stored) : null;
    } catch (error) {
      console.error('Get store context error:', error);
      return null;
    }
  }

  /**
   * Set the store context
   */
  static setContext(context: StoreContext): void {
    try {
      localStorage.setItem(STORE_CONTEXT_KEY, JSON.stringify(context));
      // Dispatch event for context change
      window.dispatchEvent(
        new CustomEvent('storeContextChanged', { detail: context })
      );
    } catch (error) {
      console.error('Set store context error:', error);
    }
  }

  /**
   * Switch to a different store
   */
  static switchStore(store: Store, userId: string): void {
    const context: StoreContext = {
      storeId: store.id,
      orgId: store.orgId,
      userId,
    };
    this.setContext(context);
  }

  /**
   * Clear the store context
   */
  static clearContext(): void {
    try {
      localStorage.removeItem(STORE_CONTEXT_KEY);
      window.dispatchEvent(
        new CustomEvent('storeContextChanged', { detail: null })
      );
    } catch (error) {
      console.error('Clear store context error:', error);
    }
  }

  /**
   * Listen for store context changes
   */
  static onContextChange(callback: (context: StoreContext | null) => void): () => void {
    const handler = (event: Event) => {
      const customEvent = event as CustomEvent;
      callback(customEvent.detail);
    };

    window.addEventListener('storeContextChanged', handler);

    return () => {
      window.removeEventListener('storeContextChanged', handler);
    };
  }
}
