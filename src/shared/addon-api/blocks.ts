import { z } from 'zod';

// The fixed UI vocabulary an add-on can return. Main validates every surface
// against these schemas before sending it to the renderer, which maps each block
// to Dash's own ui/ primitives. New block types are added when an add-on needs one.

export const ICONS = [
  'play',
  'square',
  'scroll-text',
  'external-link',
  'copy',
  'refresh-cw',
  'x',
] as const;
export type IconName = (typeof ICONS)[number];

export const IconActionSchema = z.object({
  id: z.string().min(1),
  icon: z.enum(ICONS),
  tooltip: z.string(),
});
export type IconAction = z.infer<typeof IconActionSchema>;

const TextBlockSchema = z.object({
  type: z.literal('text'),
  text: z.string(),
  tone: z.enum(['muted', 'error', 'success']).optional(),
});

const RowBlockSchema = z.object({
  type: z.literal('row'),
  label: z.string().min(1),
  meta: z.string().optional(),
  status: z.enum(['up', 'down', 'unknown']).optional(),
  tooltip: z.string().optional(),
  onClick: z.string().optional(),
  actions: z.array(IconActionSchema).optional(),
});

const ListBlockSchema = z.object({
  type: z.literal('list'),
  rows: z.array(RowBlockSchema),
});

const ButtonBlockSchema = z.object({
  type: z.literal('button'),
  id: z.string().min(1),
  label: z.string().min(1),
  primary: z.boolean().optional(),
  busy: z.boolean().optional(),
});

const ProgressBlockSchema = z.object({
  type: z.literal('progress'),
  value: z.number().min(0).max(1).optional(),
  label: z.string().optional(),
});

const CodeBlockSchema = z.object({
  type: z.literal('code'),
  text: z.string(),
  label: z.string().optional(),
});

export const BlockSchema = z.discriminatedUnion('type', [
  TextBlockSchema,
  RowBlockSchema,
  ListBlockSchema,
  ButtonBlockSchema,
  ProgressBlockSchema,
  CodeBlockSchema,
]);
export type Block = z.infer<typeof BlockSchema>;
export type TextBlock = z.infer<typeof TextBlockSchema>;
export type RowBlock = z.infer<typeof RowBlockSchema>;
export type ListBlock = z.infer<typeof ListBlockSchema>;
export type ButtonBlock = z.infer<typeof ButtonBlockSchema>;
export type ProgressBlock = z.infer<typeof ProgressBlockSchema>;
export type CodeBlock = z.infer<typeof CodeBlockSchema>;

export const BlocksSchema = z.array(BlockSchema);

export const DrawerSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional(),
  actions: z.array(IconActionSchema).optional(),
  blocks: BlocksSchema,
});
export type Drawer = z.infer<typeof DrawerSchema>;

// ── Builders ────────────────────────────────────────────────────

export function text(value: string, tone?: TextBlock['tone']): TextBlock {
  return tone ? { type: 'text', text: value, tone } : { type: 'text', text: value };
}

export function row(label: string, opts: Omit<RowBlock, 'type' | 'label'> = {}): RowBlock {
  return { type: 'row', label, ...opts };
}

export function list(rows: RowBlock[]): ListBlock {
  return { type: 'list', rows };
}

export function button(
  id: string,
  label: string,
  opts: Omit<ButtonBlock, 'type' | 'id' | 'label'> = {},
): ButtonBlock {
  return { type: 'button', id, label, ...opts };
}

export function progress(opts: Omit<ProgressBlock, 'type'> = {}): ProgressBlock {
  return { type: 'progress', ...opts };
}

export function code(value: string, label?: string): CodeBlock {
  return label ? { type: 'code', text: value, label } : { type: 'code', text: value };
}

export function iconAction(id: string, icon: IconName, tooltip: string): IconAction {
  return { id, icon, tooltip };
}
