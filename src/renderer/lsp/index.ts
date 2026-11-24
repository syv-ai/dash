import { startDocumentSync } from './documentSync';
import { startDiagnostics } from './diagnostics';
import { registerOpener } from './opener';
import { registerProviders } from './providers';
import { startLspStatusFeed } from '../stores/lspStatusStore';

let installed = false;

/**
 * Code intelligence from the language servers main runs: document sync,
 * Monaco's language features, diagnostics, cross-file navigation and the
 * status feed. Once per window; it lives as long as the window does.
 */
export function installLsp(): void {
  if (installed) return;
  installed = true;
  registerProviders();
  registerOpener();
  startDiagnostics();
  startLspStatusFeed();
  startDocumentSync();
}
