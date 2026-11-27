/**
 * Class fragments shared across the primitives, so the families that must look
 * alike (every menu, every focusable control) are styled in one place.
 */

/** Keyboard focus: a 2px focus-blue outline, offset 1. */
export const focusRing =
  'outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus';

/** Meta text inside a `ListRow` that recedes while the row is at rest and
 *  comes back to its ink on hover, selection or keyboard focus (a task's
 *  project line). ink-3 is the faintest ink, so this quiets it further. */
export const quietAtRest =
  'opacity-70 transition-opacity group-hover/row:opacity-100 group-data-[selected=true]/row:opacity-100 group-focus-visible/row:opacity-100';

/** A floating surface: menus, popovers, the command list, select content. */
export const menuSurface =
  'z-50 rounded-lg bg-raised p-1.5 text-ink shadow-raised outline-none animate-popover-in';

/** A toast: the floating sheet every toast sits on, the ports wizard's
 *  included (the Toaster puts it on each sonner `<li>`). Its width and the
 *  stack's motion are in index.css, under the sonner block. */
export const toastSurface = `group/toast overflow-hidden rounded-xl bg-raised text-ink shadow-raised ${focusRing}`;

/** A toast's content padding (`ToastView`, the ports wizard). */
export const toastBody = 'px-3 py-2.5';

/** A row in a floating menu; its icons rest in the icon token. */
export const menuItem =
  'relative flex h-8 cursor-default select-none items-center gap-2 rounded-md px-3 text-sm text-ink outline-none transition-colors [&_svg]:shrink-0 [&_svg]:text-icon';

/** Radix menu row states: present-or-absent `data-highlighted` / `data-disabled`.
 *  (cmdk writes `data-disabled="false"`, so Command spells its own.) */
export const radixMenuItemStates =
  'data-highlighted:bg-hover data-disabled:pointer-events-none data-disabled:opacity-40';

/** A destructive menu row (Delete): fail ink, fail-tinted highlight. */
export const menuItemDestructive =
  'text-state-fail [&_svg]:text-state-fail data-highlighted:bg-state-fail/10';

/** A section label inside a menu. */
export const menuLabel = 'type-subheading px-3 pt-2 pb-1';

/** A hairline between menu groups. */
export const menuSeparator = '-mx-1.5 my-1.5 h-px bg-line';

/** Text fields: hover-tint fill, no border; focus = a subtle line ring on the well. */
export const fieldBase =
  'w-full min-w-0 rounded-md bg-hover px-2.5 text-sm text-ink outline-none transition-colors placeholder:text-ink-3 hover:bg-select focus-visible:bg-well focus-visible:ring-1 focus-visible:ring-line disabled:pointer-events-none disabled:opacity-40';
