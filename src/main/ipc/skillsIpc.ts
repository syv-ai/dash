import { ipcMain } from 'electron';
import { z } from 'zod';
import { SkillsService } from '../services/SkillsService';
import { parseArgs, errorResponse } from './validate';
import type {
  SkillRef,
  SkillInstallArgs,
  SkillUninstallArgs,
  SkillsSearchArgs,
  SkillInstallTarget,
} from '@shared/types';

const skillRefSchema = z.looseObject({
  repo: z.string(),
  path: z.string(),
  branch: z.string(),
});

const skillInstallTargetSchema = z.looseObject({ kind: z.string() });

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function fail(errorId: string, err: unknown, ctx?: Record<string, unknown>) {
  console.error(`[skillsIpc.${errorId}]`, { message: describe(err), ...ctx });
  return errorResponse(err);
}

export function registerSkillsIpc(): void {
  ipcMain.handle('skills:refresh', async (_event, args?: { force?: boolean }) => {
    try {
      parseArgs(
        'skills:refresh',
        z.looseObject({ force: z.boolean().optional() }).optional(),
        args,
      );
      const meta = await SkillsService.ensureRegistry(args?.force === true);
      return { success: true, data: meta };
    } catch (error) {
      return fail('SKILLS_REFRESH', error, { force: args?.force });
    }
  });

  ipcMain.handle('skills:getMeta', () => {
    try {
      return { success: true, data: SkillsService.getMeta() };
    } catch (error) {
      return fail('SKILLS_GET_META', error);
    }
  });

  ipcMain.handle('skills:getCategories', () => {
    try {
      return { success: true, data: SkillsService.getCategories() };
    } catch (error) {
      return fail('SKILLS_GET_CATEGORIES', error);
    }
  });

  ipcMain.handle('skills:search', (_event, args: SkillsSearchArgs) => {
    try {
      parseArgs(
        'skills:search',
        z.looseObject({
          query: z.string(),
          category: z.string().optional(),
          limit: z.number().optional(),
          offset: z.number().optional(),
        }),
        args,
      );
      const data = SkillsService.search(args);
      return { success: true, data };
    } catch (error) {
      return fail('SKILLS_SEARCH', error, {
        query: args?.query,
        category: args?.category,
      });
    }
  });

  ipcMain.handle('skills:getContent', async (_event, args: SkillRef) => {
    try {
      parseArgs('skills:getContent', skillRefSchema, args);
      const data = await SkillsService.getSkillContent(args);
      return { success: true, data };
    } catch (error) {
      return fail('SKILLS_GET_CONTENT', error, { repo: args?.repo, path: args?.path });
    }
  });

  ipcMain.handle(
    'skills:readLocalSkillMd',
    (_event, args: { skillName: string; target: SkillInstallTarget }) => {
      try {
        parseArgs(
          'skills:readLocalSkillMd',
          z.looseObject({ skillName: z.string(), target: skillInstallTargetSchema }),
          args,
        );
        const data = SkillsService.readLocalSkillMd(args);
        return { success: true, data };
      } catch (error) {
        return fail('SKILLS_READ_LOCAL', error, {
          skillName: args?.skillName,
          targetKind: args?.target?.kind,
        });
      }
    },
  );

  ipcMain.handle('skills:install', async (_event, args: SkillInstallArgs) => {
    try {
      parseArgs(
        'skills:install',
        z.looseObject({
          ref: skillRefSchema,
          skillName: z.string(),
          target: skillInstallTargetSchema,
        }),
        args,
      );
      await SkillsService.installSkill(args);
      return { success: true };
    } catch (error) {
      return fail('SKILLS_INSTALL', error, {
        repo: args?.ref?.repo,
        skillName: args?.skillName,
        target: args?.target?.kind,
      });
    }
  });

  ipcMain.handle('skills:listInstalled', async (_event, args: { probePaths: string[] }) => {
    try {
      parseArgs('skills:listInstalled', z.looseObject({ probePaths: z.array(z.string()) }), args);
      const data = await SkillsService.listInstalled(args?.probePaths ?? []);
      return { success: true, data };
    } catch (error) {
      return fail('SKILLS_LIST_INSTALLED', error);
    }
  });

  ipcMain.handle(
    'skills:checkInstalled',
    (_event, args: { skillName: string; probePaths: string[]; ref?: SkillRef | null }) => {
      try {
        parseArgs(
          'skills:checkInstalled',
          z.looseObject({
            skillName: z.string(),
            probePaths: z.array(z.string()),
            ref: skillRefSchema.nullable().optional(),
          }),
          args,
        );
        const data = SkillsService.checkInstalled(
          args.skillName,
          args.probePaths,
          args.ref ?? null,
        );
        return { success: true, data };
      } catch (error) {
        return fail('SKILLS_CHECK_INSTALLED', error, { skillName: args?.skillName });
      }
    },
  );

  ipcMain.handle('skills:resetCache', async () => {
    try {
      const meta = await SkillsService.resetCache();
      return { success: true, data: meta };
    } catch (error) {
      return fail('SKILLS_RESET_CACHE', error);
    }
  });

  ipcMain.handle('skills:uninstall', (_event, args: SkillUninstallArgs) => {
    try {
      parseArgs(
        'skills:uninstall',
        z.looseObject({ skillName: z.string(), target: skillInstallTargetSchema }),
        args,
      );
      SkillsService.uninstallSkill(args);
      return { success: true };
    } catch (error) {
      return fail('SKILLS_UNINSTALL', error, {
        skillName: args?.skillName,
        target: args?.target?.kind,
      });
    }
  });
}
