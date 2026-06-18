import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import type { SkillVisibility } from '@shared/types';

const VALID: ReadonlySet<string> = new Set(['on', 'name-only', 'user-invocable-only', 'off']);

function readSettings(file: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    // Missing or malformed → treat as empty so a write can recover it.
    return {};
  }
}

export function readSkillOverrides(settingsFile: string): Record<string, SkillVisibility> {
  const o = readSettings(settingsFile).skillOverrides;
  if (!o || typeof o !== 'object') return {};
  const out: Record<string, SkillVisibility> = {};
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    if (typeof v === 'string' && VALID.has(v)) out[k] = v as SkillVisibility;
  }
  return out;
}

/** Merge-write: preserves all other settings keys. `null` clears the override. */
export function setSkillOverride(
  settingsFile: string,
  skillName: string,
  visibility: SkillVisibility | null,
): void {
  if (visibility !== null && !VALID.has(visibility)) {
    throw new Error(`Invalid skill visibility: ${JSON.stringify(visibility)}`);
  }
  const settings = readSettings(settingsFile);
  const overrides = { ...readSkillOverrides(settingsFile) };
  if (visibility === null) delete overrides[skillName];
  else overrides[skillName] = visibility;

  if (Object.keys(overrides).length === 0) delete settings.skillOverrides;
  else settings.skillOverrides = overrides;

  mkdirSync(path.dirname(settingsFile), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
}
