import { ipcMain } from 'electron';
import { SkillsService } from '../services/SkillsService';

export function registerSkillsIpc(): void {
  ipcMain.handle('skills:fetchRegistry', async (_event, args?: { forceRefresh?: boolean }) => {
    try {
      const data = await SkillsService.fetchRegistry(args?.forceRefresh);
      return { success: true, data };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  ipcMain.handle(
    'skills:search',
    async (_event, args: { query: string; category?: string; limit?: number; offset?: number }) => {
      try {
        const data = await SkillsService.search(args.query, args.category, args.limit, args.offset);
        return { success: true, data };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'skills:getContent',
    async (_event, args: { repo: string; path: string; branch: string }) => {
      try {
        const data = await SkillsService.getSkillContent(args.repo, args.path, args.branch);
        return { success: true, data };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'skills:install',
    async (
      _event,
      args: {
        repo: string;
        path: string;
        branch: string;
        skillName: string;
        target: 'global' | 'project';
        projectPath?: string;
      },
    ) => {
      try {
        await SkillsService.installSkill(args);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'skills:checkInstalled',
    (_event, args: { skillName: string; projectPaths: string[] }) => {
      try {
        const data = SkillsService.checkInstalled(args.skillName, args.projectPaths);
        return { success: true, data };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );

  ipcMain.handle(
    'skills:uninstall',
    (_event, args: { skillName: string; target: 'global' | 'project'; projectPath?: string }) => {
      try {
        SkillsService.uninstallSkill(args);
        return { success: true };
      } catch (error) {
        return { success: false, error: String(error) };
      }
    },
  );
}
