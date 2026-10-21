import { describe, it, expect } from 'vitest';
import { createAccessGate } from '../accessGate';

function deferred() {
  let resolve!: (v: boolean) => void;
  const promise = new Promise<boolean>((r) => (resolve = r));
  return { promise, resolve };
}

describe('createAccessGate', () => {
  it("doesn't ask while access is already on", async () => {
    let asked = 0;
    const gate = createAccessGate({ isAllowed: () => true, ask: async () => (asked++, false) });
    expect(await gate()).toBe(true);
    expect(asked).toBe(0);
  });

  it('asks once for calls that arrive while the prompt is open', async () => {
    const answer = deferred();
    let asked = 0;
    const gate = createAccessGate({
      isAllowed: () => false,
      ask: () => (asked++, answer.promise),
    });
    const a = gate();
    const b = gate();
    answer.resolve(true);
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(asked).toBe(1);
  });

  it('refuses without asking for a while after a Deny, then asks again', async () => {
    let t = 0;
    let asked = 0;
    const gate = createAccessGate({
      isAllowed: () => false,
      ask: async () => (asked++, false),
      now: () => t,
      denyCooldownMs: 1000,
    });
    expect(await gate()).toBe(false);
    t = 999;
    expect(await gate()).toBe(false);
    expect(asked).toBe(1);
    t = 1000;
    expect(await gate()).toBe(false);
    expect(asked).toBe(2);
  });

  it('treats a prompt that fails as a Deny', async () => {
    const gate = createAccessGate({
      isAllowed: () => false,
      ask: () => Promise.reject(new Error('no window')),
    });
    expect(await gate()).toBe(false);
  });
});
