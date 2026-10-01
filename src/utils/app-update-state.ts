let update: (() => Promise<void>) | null = null;
const listeners = new Set<() => void>();
export function offerAppUpdate(action: () => Promise<void>) { update = action; listeners.forEach(listener => listener()); }
export function subscribeToUpdate(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function pendingUpdate() { return update; }
