# UI Style Guide

This document defines the visual conventions for Dash's renderer UI. All components live in `src/renderer/components/` with shared primitives in `src/renderer/components/ui/`.

## Theme System

Dash supports light and dark themes via a CSS class (`dark` / `light`) on the document root. All colors must come from CSS custom properties defined in `src/renderer/index.css` and mapped through `tailwind.config.js` — never use raw hex/rgb values in components.

### Semantic Color Tokens

| Token                                                     | Usage                                               |
| --------------------------------------------------------- | --------------------------------------------------- |
| `foreground`                                              | Primary text                                        |
| `muted-foreground`                                        | Secondary/subdued text, icon default state          |
| `background`                                              | Page background                                     |
| `surface-{0..3}`                                          | Layered surface backgrounds (0 = base, 3 = highest) |
| `accent`                                                  | Subtle hover/active backgrounds                     |
| `primary`                                                 | Brand color, active states, focus rings             |
| `destructive`                                             | Delete/danger actions                               |
| `border`                                                  | Borders and dividers                                |
| `git-added/modified/deleted/renamed/untracked/conflicted` | Git status colors                                   |

### Key Rule

Never use opacity modifiers on `text-muted-foreground` for interactive elements (e.g. `text-muted-foreground/50`). This makes icons invisible in both themes. Use `text-muted-foreground` at full opacity for a visible-but-subdued look.

Opacity modifiers are acceptable for purely decorative, non-interactive elements (e.g. a count badge: `text-muted-foreground/30`).

## UI Components (`src/renderer/components/ui/`)

### `IconButton`

Standard icon button used across the app. Provides consistent sizing, color, and hover behavior in both themes.

```tsx
import { IconButton } from './ui/IconButton';

// Default — muted icon, highlights on hover
<IconButton onClick={handleClick} title="Open folder">
  <FolderOpen size={14} strokeWidth={1.8} />
</IconButton>

// Destructive — muted icon, turns red on hover
<IconButton onClick={handleDelete} title="Delete" variant="destructive">
  <Trash2 size={14} strokeWidth={1.8} />
</IconButton>

// Small — compact padding for inline use (e.g. inside list rows)
<IconButton onClick={handleClick} title="Add" size="sm">
  <Plus size={12} strokeWidth={2} />
</IconButton>
```

**Props:**

- `variant`: `"default"` (hover: accent bg + foreground text) or `"destructive"` (hover: red tint bg + destructive text)
- `size`: `"md"` (default, `p-1.5`) or `"sm"` (`p-0.5`, for inline/row contexts)
- `className`: Additional classes (e.g. `"titlebar-no-drag"`)

**When to use:** Any clickable icon without a text label. Always prefer `IconButton` over a raw `<button>` with manual styling.

## Icon Conventions

- **Library:** Lucide React (`lucide-react`)
- **Default size:** 14px for standalone buttons, 11–12px for inline/row actions
- **Stroke width:** 1.8 for most icons, 2 for very small icons (< 12px)
- **Color:** Inherited from parent — never set color directly on the icon. Let `IconButton` or the parent element control it.

## Buttons

- **Single-line buttons** (sidebar rows, action bars): `rounded-full` (pill shape)
- **Multi-line / block buttons** (modals, forms): `rounded-lg`

## Spacing & Shapes

- **Sidebar cards (projects, tasks):** `rounded-full` (pill shape)
- **Modals, panels:** `rounded-lg`
- **Icon buttons:** `rounded-md`
- **Transitions:** `duration-150` for interactions, `duration-200` for layout animations (e.g. collapse/expand)

## Collapse/Expand Animation

Use the CSS grid technique for smooth height transitions:

```tsx
<div
  className="grid transition-[grid-template-rows] duration-200 ease-in-out"
  style={{ gridTemplateRows: isCollapsed ? '0fr' : '1fr' }}
>
  <div className="overflow-hidden">{/* content */}</div>
</div>
```

This avoids JS-based height measurement and supports variable-height content.
