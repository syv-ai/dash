import { describe, expect, it } from 'vitest';
import { checkoutNotice, nextLiveAt, reviewCheckout } from '../checkout';

const at = { atHead: true, ahead: 0, behind: 0 };
const rule = (over: Partial<Parameters<typeof reviewCheckout>[0]> = {}) =>
  reviewCheckout({
    facts: at,
    branch: 'feat',
    headRef: 'feat',
    uncommitted: false,
    wasLive: false,
    ...over,
  });

describe('reviewCheckout', () => {
  it('is live at the PR head with a clean tree', () => {
    expect(rule()).toEqual({ live: true, differences: [] });
  });

  it('is the read-only PR head with uncommitted changes, and says so', () => {
    expect(rule({ uncommitted: true })).toEqual({
      live: false,
      differences: ['uncommitted changes'],
    });
  });

  it('stays live once edited there, the notice appearing', () => {
    expect(rule({ uncommitted: true, wasLive: true })).toEqual({
      live: true,
      differences: ['uncommitted changes'],
    });
  });

  it('counts local commits and commits behind on the head branch', () => {
    const facts = { atHead: false, ahead: 2, behind: 1 };
    expect(rule({ facts })).toEqual({
      live: false,
      differences: ['2 local commits', '1 commit behind'],
    });
    expect(rule({ facts, wasLive: true }).live).toBe(false);
  });

  it('tells nothing off the head branch (a PR into this branch): differing is expected', () => {
    const facts = { atHead: false, ahead: 9, behind: 3 };
    expect(rule({ facts, branch: 'main', uncommitted: true })).toEqual({
      live: false,
      differences: [],
    });
    expect(rule({ facts, branch: null }).differences).toEqual([]);
  });

  it('is read-only without facts (not known yet, or the head never fetched)', () => {
    expect(rule({ facts: null })).toEqual({ live: false, differences: [] });
  });

  it("starts read-only while the tree's status is unknown (it may be dirty, D124)", () => {
    expect(rule({ uncommitted: null })).toEqual({ live: false, differences: [] });
    expect(rule({ uncommitted: null, wasLive: true }).live).toBe(true);
  });
});

describe('nextLiveAt', () => {
  const head = 'h1';
  it('records the head it is live at', () => {
    expect(nextLiveAt({ live: true, head, facts: at, liveAt: null })).toBe(head);
  });

  it('keeps it until the checkout is known to have left the head', () => {
    expect(nextLiveAt({ live: false, head, facts: null, liveAt: head })).toBe(head);
    expect(nextLiveAt({ live: false, head, facts: at, liveAt: head })).toBe(head);
    const left = { atHead: false, ahead: 1, behind: 0 };
    expect(nextLiveAt({ live: false, head, facts: left, liveAt: head })).toBeNull();
  });
});

describe('checkoutNotice', () => {
  it('lists the differences in one line; none, no notice', () => {
    expect(checkoutNotice(['1 local commit', 'uncommitted changes'])).toBe(
      'Your checkout differs from the PR: 1 local commit · uncommitted changes. Exit review to see them.',
    );
    expect(checkoutNotice([])).toBeNull();
  });
});
