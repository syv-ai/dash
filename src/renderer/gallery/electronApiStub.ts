/**
 * The gallery runs in a plain browser, where preload's `window.electronAPI` is
 * missing. Primitives that touch a store (TokenBadge, Toast) only call it
 * lazily; this stand-in answers every method with a no-op that also works as
 * an unsubscribe function, so those calls neither throw nor do anything.
 */
export function installElectronApiStub(): void {
  const w = window as unknown as { electronAPI?: unknown };
  if (w.electronAPI) return;
  const noop = () => noop;
  w.electronAPI = new Proxy({}, { get: () => noop });
}
