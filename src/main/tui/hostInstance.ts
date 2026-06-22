import { WizardHost } from '../wizard/WizardHost';

let host: WizardHost | null = null;

/** Lazy singleton for the wizard host (its UI is a persistent renderer toast). */
export function getTuiHost(): WizardHost {
  if (!host) host = new WizardHost();
  return host;
}
