import type { Addon } from '@shared/addon-api';

/**
 * Every add-on Dash ships, in the order their env contributions are merged
 * (later wins). Each lives in its own folder here and imports only
 * @shared/addon-api. See docs/specs/2026-09-23-addons.md.
 */
export const ADDONS: Addon[] = [];
