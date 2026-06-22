import { ipcMain } from 'electron';
import { z } from 'zod';
import { parseArgs, errorResponse } from './validate';
import { getExtensionsOverview } from '../services/extensionsModel';
import {
  getPluginComponents,
  getPluginComponentDetail,
  getSkillDetail,
  getRegistrySkillDetail,
} from '../services/extensionsDetail';
import { settingsFilePath } from '../services/extensionScopes';
import { setSkillOverride } from '../services/skillOverrides';
import type {
  ExtensionScopeInput,
  SetSkillOverrideArgs,
  GetPluginComponentsArgs,
  GetPluginComponentDetailArgs,
  GetSkillDetailArgs,
  SkillRef,
} from '@shared/types';

export const extensionScopeInputSchema = z.looseObject({
  projects: z.array(z.looseObject({ id: z.string(), name: z.string(), path: z.string() })),
  tasks: z.array(
    z.looseObject({
      taskId: z.string(),
      name: z.string(),
      worktreePath: z.string(),
      projectId: z.string(),
    }),
  ),
});

const scopeRefSchema = z.looseObject({
  id: z.string(),
  kind: z.enum(['global', 'project', 'task']),
  name: z.string(),
  path: z.string(),
  projectId: z.string().optional(),
});

export const setSkillOverrideSchema = z.looseObject({
  scope: scopeRefSchema,
  skillName: z.string(),
  visibility: z.enum(['on', 'name-only', 'user-invocable-only', 'off']).nullable(),
});

export const getPluginComponentsSchema = z.looseObject({ pluginId: z.string() });

export const getPluginComponentDetailSchema = z.looseObject({
  pluginId: z.string(),
  kind: z.enum(['skill', 'agent', 'command', 'hook']),
  name: z.string(),
});

export const getSkillDetailSchema = z.looseObject({
  scope: scopeRefSchema,
  skillName: z.string(),
});

export const registrySkillRefSchema = z.looseObject({
  repo: z.string(),
  path: z.string(),
  branch: z.string(),
});

function fail(errorId: string, err: unknown) {
  console.error(`[extensionsIpc.${errorId}]`, {
    message: err instanceof Error ? err.message : String(err),
  });
  return errorResponse(err);
}

export function registerExtensionsIpc(): void {
  ipcMain.handle('extensions:getOverview', async (_event, args: ExtensionScopeInput) => {
    try {
      parseArgs('extensions:getOverview', extensionScopeInputSchema, args);
      return { success: true, data: await getExtensionsOverview(args) };
    } catch (error) {
      return fail('GET_OVERVIEW', error);
    }
  });

  ipcMain.handle('extensions:setSkillOverride', (_event, args: SetSkillOverrideArgs) => {
    try {
      parseArgs('extensions:setSkillOverride', setSkillOverrideSchema, args);
      setSkillOverride(settingsFilePath(args.scope), args.skillName, args.visibility);
      return { success: true };
    } catch (error) {
      return fail('SET_SKILL_OVERRIDE', error);
    }
  });

  ipcMain.handle(
    'extensions:getPluginComponents',
    async (_event, args: GetPluginComponentsArgs) => {
      try {
        parseArgs('extensions:getPluginComponents', getPluginComponentsSchema, args);
        return { success: true, data: await getPluginComponents(args.pluginId) };
      } catch (error) {
        return fail('GET_PLUGIN_COMPONENTS', error);
      }
    },
  );

  ipcMain.handle(
    'extensions:getPluginComponentDetail',
    async (_event, args: GetPluginComponentDetailArgs) => {
      try {
        parseArgs('extensions:getPluginComponentDetail', getPluginComponentDetailSchema, args);
        return { success: true, data: await getPluginComponentDetail(args) };
      } catch (error) {
        return fail('GET_PLUGIN_COMPONENT_DETAIL', error);
      }
    },
  );

  ipcMain.handle('extensions:getSkillDetail', (_event, args: GetSkillDetailArgs) => {
    try {
      parseArgs('extensions:getSkillDetail', getSkillDetailSchema, args);
      return { success: true, data: getSkillDetail(args.scope.path, args.skillName) };
    } catch (error) {
      return fail('GET_SKILL_DETAIL', error);
    }
  });

  ipcMain.handle('extensions:getRegistrySkillDetail', async (_event, args: SkillRef) => {
    try {
      parseArgs('extensions:getRegistrySkillDetail', registrySkillRefSchema, args);
      return { success: true, data: await getRegistrySkillDetail(args) };
    } catch (error) {
      return fail('GET_REGISTRY_SKILL_DETAIL', error);
    }
  });
}
