import type { RegistrySkill } from './types';

// Single source of truth for the folder name a registry skill installs into. Both the
// renderer (deriving the name before calling install/uninstall) and the main process
// (matching marker-less folders against catalog entries during backfill) must agree —
// previously we had two near-identical copies kept in sync by comment.
export function deriveSkillFolderName(skill: Pick<RegistrySkill, 'name' | 'path'>): string {
  const candidates = [skill.name, lastPathSegment(skill.path)];
  for (const c of candidates) {
    if (!c) continue;
    const sanitized = sanitizeForFilesystem(c);
    if (sanitized && sanitized !== 'unknown' && /^[a-z0-9]/.test(sanitized)) return sanitized;
  }
  return '';
}

function lastPathSegment(p: string): string {
  const segs = p.split('/').filter(Boolean);
  const last = segs[segs.length - 1] ?? '';
  if (last.toLowerCase() === 'skill.md') return segs[segs.length - 2] ?? '';
  return last;
}

function sanitizeForFilesystem(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}
