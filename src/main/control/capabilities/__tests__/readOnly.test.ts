import { describe, it, expect } from 'vitest';
import { createRegistry } from '../../registry';
import { fakeLookups } from '../../__tests__/fixtures';
import { registerProjectCapabilities } from '../projects';
import { registerTaskCapabilities } from '../tasks';
import { registerServiceCapabilities } from '../services';
import { registerReviewCapabilities } from '../review';

describe('read-only capabilities', () => {
  it('are exactly the ones with no side effects', () => {
    const registry = createRegistry(fakeLookups([], []));
    registerProjectCapabilities(registry, {} as never);
    registerTaskCapabilities(registry, {} as never);
    registerServiceCapabilities(registry, {} as never);
    registerReviewCapabilities(registry, {} as never);
    expect(registry.readOnlyNames().sort()).toEqual([
      'projects.list',
      'review.drafts_list',
      'review.summary_get',
      'services.list',
      'services.output',
      'tasks.get',
      'tasks.list',
      'tasks.output',
      'tasks.wait',
    ]);
    // tasks.wake starts a session, so an in-task agent is asked first.
    const names = registry.listFor({ kind: 'orchestrator' }).map((c) => c.name);
    expect(names).toContain('tasks.wake');
  });
});
