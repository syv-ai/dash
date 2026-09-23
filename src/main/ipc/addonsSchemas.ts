import { z } from 'zod';

// Payload schemas for addonsIpc, kept apart so they can be tested without
// loading the host and its core dependencies.

export const setEnabledSchema = z.object({ id: z.string().min(1), enabled: z.boolean() });

export const surfacesSchema = z.object({ taskId: z.string().min(1).nullable() });

export const actionSchema = z.object({
  addonId: z.string().min(1),
  ref: z.object({
    surface: z.enum(['settings', 'drawer']),
    taskId: z.string().min(1).optional(),
  }),
  actionId: z.string().min(1),
});

export const terminalClosedSchema = z.object({
  taskId: z.string().min(1),
  tabId: z.string().min(1),
});
