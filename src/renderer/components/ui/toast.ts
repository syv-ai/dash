/**
 * The app's toasts. The only module that raises a sonner toast; every toast
 * is a `ToastView` on the Toaster's surface. Durations, dedupe and the focus
 * gate come from `toastPolicy`; no caller passes a duration.
 *
 * Same kind and title (or the same `key`) → one toast, updated in place, its
 * countdown restarted: an IPC failing in a loop gives one toast, not a stack.
 */
import { createElement, type ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';
import { toast as sonner } from 'sonner';
import type { ToastKind, ToastPayload } from '@shared/toast';
import { useSettings } from '../../stores/settingsStore';
import { ToastView, type ToastViewKind } from './Toaster';
import {
  LASTING_TOAST_DURATION,
  STICKY_OFFER_DURATION,
  TOAST_DURATION,
  copiedContent,
  createFocusGate,
  fromPayload,
  toastId,
} from './toastPolicy';

export type ToastAction = { label: string; onClick: () => void };

export interface ToastOptions {
  /** A sentence under the title. */
  description?: string;
  /** A meta line under the title: a task name, a path. */
  meta?: string;
  /** Collapses repeats into one toast; defaults to kind + title. */
  key?: string;
  action?: ToastAction;
  /** A condition that lasts (duplicate task directories): stays 20 s. */
  lasting?: boolean;
}

export interface OfferOptions extends Omit<ToastOptions, 'lasting'> {
  action: ToastAction;
  icon?: LucideIcon;
  /** `updates` is muted by the "update notifications" setting. */
  topic?: 'updates';
  /** Stays until acted on or closed (`STICKY_OFFER_DURATION`), for an offer
   *  that holds something the person would otherwise lose. */
  sticky?: boolean;
  /** The toast closed by the person's hand: its ✕, or after its action. */
  onDismiss?: () => void;
}

export type ToastResult = { kind: ToastKind; title: string; description?: string };

interface Shown extends Omit<ToastOptions, 'key' | 'lasting'> {
  id: string;
  kind: ToastViewKind;
  title: string;
  duration: number;
  icon?: LucideIcon;
  onDismiss?: () => void;
}

function show({ id, kind, title, duration, onDismiss, ...view }: Shown): string {
  sonner.custom(() => createElement(ToastView, { id, kind, title, ...view }), {
    id,
    duration,
    onDismiss,
  });
  return id;
}

function simple(kind: ToastKind) {
  return (title: string, o: ToastOptions = {}): string => {
    const { key, lasting, ...view } = o;
    return show({
      ...view,
      id: toastId(kind, title, key),
      kind,
      title,
      duration: lasting ? LASTING_TOAST_DURATION : TOAST_DURATION[kind],
    });
  };
}

/** Offers wait until the window has focus (sonner keeps counting while Dash
 *  is visible behind another app). Made on first use: tests import this
 *  module's callers under plain Node. */
let focusGate: ReturnType<typeof createFocusGate> | null = null;
function offerGate() {
  if (!focusGate) {
    const gate = createFocusGate(() => document.hasFocus());
    window.addEventListener('focus', () => gate.flush());
    focusGate = gate;
  }
  return focusGate;
}

export const toast = {
  info: simple('info'),
  success: simple('success'),
  warning: simple('warning'),
  error: simple('error'),

  /** "Copied <what>", for a copy from a menu or shortcut (a copy button
   *  confirms in place instead). */
  copied(what: string, text: string): string {
    const content = copiedContent(what, text);
    return show({
      ...content,
      id: toastId('copied', content.title),
      kind: 'copied',
      duration: TOAST_DURATION.copied,
    });
  },

  /** News with one action: waits for focus, keeps its ✕, stays 20 s. */
  offer(title: string, o: OfferOptions): void {
    const { key, topic, sticky, ...view } = o;
    if (topic === 'updates' && !useSettings.getState().updateNotificationsEnabled) return;
    const id = toastId('offer', title, key);
    const duration = sticky ? STICKY_OFFER_DURATION : TOAST_DURATION.offer;
    offerGate().run(() => show({ ...view, id, kind: 'offer', title, duration }));
  },

  /** One toast for work in flight that becomes its result; `success`
   *  returning null dismisses it. Resolves or rejects as `work` does. */
  progress<T>(
    work: Promise<T>,
    m: {
      loading: string;
      success: (t: T) => ToastResult | null;
      error: (e: unknown) => ToastResult;
    },
  ): Promise<T> {
    const id = toastId('progress', m.loading);
    show({ id, kind: 'progress', title: m.loading, duration: TOAST_DURATION.progress });
    const settle = (r: ToastResult | null) => {
      if (!r) sonner.dismiss(id);
      else show({ ...r, id, duration: TOAST_DURATION[r.kind] });
    };
    work.then(
      (t) => settle(m.success(t)),
      (e: unknown) => settle(m.error(e)),
    );
    return work;
  },

  /** A persistent toast with its own content (the ports wizard), on the same surface. */
  custom(
    key: string,
    render: (id: string | number) => ReactElement,
    o: { dismissible?: boolean } = {},
  ): void {
    sonner.custom(render, { id: key, duration: Infinity, dismissible: o.dismissible });
  },

  dismiss(key: string): void {
    sonner.dismiss(key);
  },

  /** A toast main raised (`toastRenderer`); a link becomes an "Open" action. */
  fromMain(p: ToastPayload): void {
    const { link, ...t } = fromPayload(p);
    show({
      ...t,
      action: link && {
        label: link.label,
        onClick: () => void window.electronAPI.openExternal(link.url),
      },
    });
  },
};
