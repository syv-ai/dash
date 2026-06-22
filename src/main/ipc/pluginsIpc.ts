import { ipcMain } from 'electron';
import { z } from 'zod';
import { PluginsService } from '../services/PluginsService';
import { parseArgs, errorResponse } from './validate';
import type {
  AddMarketplaceArgs,
  RemoveMarketplaceArgs,
  PluginInstallArgs,
  PluginUninstallArgs,
  PluginSetEnabledArgs,
} from '@shared/types';

const scopeSchema = z.enum(['user', 'project', 'local']);
const targetSchema = z.looseObject({ scope: scopeSchema, cwd: z.string().optional() });

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fail(errorId: string, err: unknown) {
  console.error(`[pluginsIpc.${errorId}]`, { message: describe(err) });
  return errorResponse(err);
}

export function registerPluginsIpc(): void {
  ipcMain.handle('plugins:getOverview', async () => {
    try {
      return { success: true, data: await PluginsService.getOverview() };
    } catch (error) {
      return fail('PLUGINS_GET_OVERVIEW', error);
    }
  });

  ipcMain.handle('plugins:addMarketplace', async (_event, args: AddMarketplaceArgs) => {
    try {
      parseArgs(
        'plugins:addMarketplace',
        z.looseObject({
          source: z.string(),
          scope: scopeSchema.optional(),
          cwd: z.string().optional(),
          sparse: z.array(z.string()).optional(),
        }),
        args,
      );
      return {
        success: true,
        data: await PluginsService.addMarketplace(args.source, args.scope, args.cwd, args.sparse),
      };
    } catch (error) {
      return fail('PLUGINS_ADD_MARKETPLACE', error);
    }
  });

  ipcMain.handle('plugins:removeMarketplace', async (_event, args: RemoveMarketplaceArgs) => {
    try {
      parseArgs(
        'plugins:removeMarketplace',
        z.looseObject({
          name: z.string(),
          scope: scopeSchema.optional(),
          cwd: z.string().optional(),
        }),
        args,
      );
      return {
        success: true,
        data: await PluginsService.removeMarketplace(args.name, args.scope, args.cwd),
      };
    } catch (error) {
      return fail('PLUGINS_REMOVE_MARKETPLACE', error);
    }
  });

  ipcMain.handle('plugins:updateMarketplace', async (_event, args?: { name?: string }) => {
    try {
      parseArgs(
        'plugins:updateMarketplace',
        z.looseObject({ name: z.string().optional() }).optional(),
        args,
      );
      return { success: true, data: await PluginsService.updateMarketplace(args?.name) };
    } catch (error) {
      return fail('PLUGINS_UPDATE_MARKETPLACE', error);
    }
  });

  ipcMain.handle('plugins:install', async (_event, args: PluginInstallArgs) => {
    try {
      parseArgs('plugins:install', z.looseObject({ id: z.string(), target: targetSchema }), args);
      return { success: true, data: await PluginsService.installPlugin(args.id, args.target) };
    } catch (error) {
      return fail('PLUGINS_INSTALL', error);
    }
  });

  ipcMain.handle('plugins:uninstall', async (_event, args: PluginUninstallArgs) => {
    try {
      parseArgs('plugins:uninstall', z.looseObject({ id: z.string(), target: targetSchema }), args);
      return { success: true, data: await PluginsService.uninstallPlugin(args.id, args.target) };
    } catch (error) {
      return fail('PLUGINS_UNINSTALL', error);
    }
  });

  ipcMain.handle('plugins:setEnabled', async (_event, args: PluginSetEnabledArgs) => {
    try {
      parseArgs(
        'plugins:setEnabled',
        z.looseObject({ id: z.string(), enabled: z.boolean(), target: targetSchema }),
        args,
      );
      return {
        success: true,
        data: await PluginsService.setEnabled(args.id, args.enabled, args.target),
      };
    } catch (error) {
      return fail('PLUGINS_SET_ENABLED', error);
    }
  });
}
