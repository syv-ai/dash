import { describe, it, expect, beforeEach } from 'vitest';
import { getStoredTab, setStoredTab } from '../tabStorage';

class MemoryStorage implements Storage {
  private store: Record<string, string> = {};
  get length() {
    return Object.keys(this.store).length;
  }
  clear() {
    this.store = {};
  }
  getItem(k: string) {
    return k in this.store ? this.store[k] : null;
  }
  key(i: number) {
    return Object.keys(this.store)[i] ?? null;
  }
  removeItem(k: string) {
    delete this.store[k];
  }
  setItem(k: string, v: string) {
    this.store[k] = v;
  }
}

beforeEach(() => {
  (globalThis as { localStorage: Storage }).localStorage = new MemoryStorage();
});

describe('tabStorage', () => {
  it('returns "changes" by default when nothing is stored', () => {
    expect(getStoredTab('task-1')).toBe('changes');
  });

  it('persists and reads the tab per task id', () => {
    setStoredTab('task-1', 'structured');
    expect(getStoredTab('task-1')).toBe('structured');
    expect(getStoredTab('task-2')).toBe('changes');
  });

  it('falls back to "changes" if stored value is unknown', () => {
    localStorage.setItem('rightInspectorTab:task-x', 'garbage');
    expect(getStoredTab('task-x')).toBe('changes');
  });
});
