import type { z } from 'zod';
import { driftValue, type DriftFinding } from './types';

/**
 * The drift in `value` against a contract schema. Schemas are strict objects
 * (`z.strictObject`), so a field Claude Code added reports as
 * `unexpected-field`; the parsed result is never used, so a mismatch changes
 * nothing downstream. Pure and cheap: one zod pass, no allocation when the
 * payload matches.
 */
export function checkShape(schema: z.ZodType, value: unknown): DriftFinding[] {
  const result = schema.safeParse(value, { reportInput: true });
  if (result.success) return [];
  const findings = new Map<string, DriftFinding>();
  const add = (f: DriftFinding) => {
    const key = `${f.kind}\0${f.path}\0${f.value ?? ''}`;
    if (!findings.has(key)) findings.set(key, f);
  };
  for (const issue of result.error.issues) {
    const at = fieldPath(issue.path) || '$';
    switch (issue.code) {
      case 'unrecognized_keys':
        for (const key of issue.keys)
          add({ kind: 'unexpected-field', path: at === '$' ? key : `${at}.${key}` });
        break;
      case 'invalid_type':
        add({
          kind: 'input' in issue && issue.input !== undefined ? 'wrong-type' : 'missing-field',
          path: at,
        });
        break;
      case 'invalid_value': {
        const input = 'input' in issue ? issue.input : undefined;
        if (input === undefined) {
          add({ kind: 'missing-field', path: at });
          break;
        }
        const value = driftValue(input);
        add({ kind: 'unknown-enum-value', path: at, ...(value === undefined ? {} : { value }) });
        break;
      }
      default:
        add({ kind: 'wrong-type', path: at });
    }
  }
  return [...findings.values()];
}

/** `['background_tasks', 0, 'type']` → `background_tasks[].type`. */
export function fieldPath(segments: readonly PropertyKey[]): string {
  let out = '';
  for (const s of segments) {
    if (typeof s === 'number') out += '[]';
    else out = join(out, String(s));
  }
  return out;
}

function join(base: string, key: string): string {
  return base ? `${base}.${key}` : key;
}
