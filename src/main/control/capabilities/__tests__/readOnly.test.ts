import { describe, it, expect } from 'vitest';
import { createRegistry } from '../../registry';
import { fakeLookups } from '../../__tests__/fixtures';
import { registerProjectCapabilities } from '../projects';
import { registerTaskCapabilities } from '../tasks';
import { registerServiceCapabilities } from '../services';
import { registerReviewCapabilities } from '../review';
import { registerPresentCapabilities } from '../present';

describe('read-only capabilities', () => {
  it('are exactly the ones with no side effects', () => {
    const registry = createRegistry(fakeLookups([], []));
    registerProjectCapabilities(registry, {} as never);
    registerTaskCapabilities(registry, {} as never);
    registerServiceCapabilities(registry, {} as never);
    registerReviewCapabilities(registry, {} as never);
    registerPresentCapabilities(registry, {} as never);
    expect(registry.readOnlyNames().sort()).toEqual([
      'projects.list',
      'review.drafts_list',
      'review.pr',
      'review.summary_get',
      'review.threads',
      'services.list',
      'services.output',
      'tasks.get',
      'tasks.list',
      'tasks.output',
      'tasks.reply',
      'tasks.wait',
      'tasks.watch',
    ]);
    // tasks.wake starts a session, so an in-task agent is asked first.
    const names = registry.listFor({ kind: 'orchestrator' }).map((c) => c.name);
    expect(names).toContain('tasks.wake');
    expect(names).toContain('tasks.message');
    // present changes what the person sees, as tasks.open does.
    expect(names).toContain('present');
  });
});
