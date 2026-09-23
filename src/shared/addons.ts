// Host ↔ renderer payloads for add-ons (IPC). Add-ons themselves use
// @shared/addon-api instead.

import type { Block, Drawer, SurfaceRef } from './addon-api';

export type AddonStatus = 'active' | 'failed' | 'disabled';

export interface AddonListItem {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  status: AddonStatus;
  error?: string;
  /** Active and declares a drawer surface. */
  hasDrawer: boolean;
  drawerSide: 'left' | 'right';
}

/** One add-on's evaluated surfaces. A surface that threw carries its error instead. */
export interface AddonSurfaceSet {
  addonId: string;
  settings?: Block[];
  settingsError?: string;
  /** Absent when the add-on has no drawer or returned null for this task. */
  drawer?: Drawer;
  drawerError?: string;
}

export interface AddonActionRequest {
  addonId: string;
  ref: SurfaceRef;
  actionId: string;
}
