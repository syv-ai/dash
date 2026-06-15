import type { TuiFeatureId } from './tuiProtocol';

/** A wizard the drawer dropdown can launch, with its human-facing label. */
export interface WizardMeta {
  id: TuiFeatureId;
  label: string;
}

/**
 * Wizards offered in the drawer "+" dropdown. Single source of truth for the
 * menu — adding a wizard is one entry here (plus its main-side registration).
 */
export const WIZARDS: WizardMeta[] = [{ id: 'ports', label: 'Port management' }];
