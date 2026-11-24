import { beforeEach, describe, expect, it } from 'vitest';
import { selectEditor, useEditors } from '../editorsStore';

const editors = () => useEditors.getState();
const editor = (cwd: string) => selectEditor(cwd)(useEditors.getState());

beforeEach(() => useEditors.setState({ byCwd: {} }));

describe('editorsStore', () => {
  it('keeps one editor per folder', () => {
    const a = { cwd: '/wt/a', filePath: 'x.ts' };
    const b = { cwd: '/wt/b', filePath: 'y.ts' };
    editors().open(a);
    editors().open(b);
    expect(editor('/wt/a')).toEqual({ target: a, hidden: false });
    expect(editor('/wt/b')).toEqual({ target: b, hidden: false });
    expect(editor('/wt/c')).toBeNull();
    expect(selectEditor(null)(editors())).toBeNull();
  });

  it('hides an open editor and shows it again on the next open', () => {
    editors().open({ cwd: '/wt/a', filePath: 'x.ts' });
    editors().hide('/wt/a');
    expect(editor('/wt/a')?.hidden).toBe(true);
    const next = { cwd: '/wt/a', filePath: 'z.ts' };
    editors().open(next);
    expect(editor('/wt/a')).toEqual({ target: next, hidden: false });
  });

  it('does not open a closed editor by hiding it', () => {
    editors().hide('/wt/a');
    expect(editor('/wt/a')).toBeNull();
  });

  it('closes one folder’s editor, leaving the others', () => {
    editors().open({ cwd: '/wt/a', filePath: '' });
    editors().open({ cwd: '/wt/b', filePath: '' });
    editors().close('/wt/a');
    expect(editor('/wt/a')).toBeNull();
    expect(editor('/wt/b')).not.toBeNull();
  });

  it('parks an editor to restore its tabs, keeping whether it was hidden', () => {
    editors().open({
      cwd: '/wt/a',
      filePath: 'x.ts',
      initialView: { kind: 'working', ref: 'index' },
    });
    editors().hide('/wt/a');
    editors().park('/wt/a');
    expect(editor('/wt/a')).toEqual({ target: { cwd: '/wt/a', filePath: '' }, hidden: true });
  });

  it('leaves an already-restoring target as it is when parked', () => {
    const target = { cwd: '/wt/a', filePath: '' };
    editors().open(target);
    editors().park('/wt/a');
    expect(editor('/wt/a')?.target).toBe(target);
  });
});
