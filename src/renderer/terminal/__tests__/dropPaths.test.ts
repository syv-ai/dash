import { describe, it, expect } from 'vitest';
import { droppedPathsText, escapeDroppedPath } from '../dropPaths';

describe('escapeDroppedPath', () => {
  it('leaves a plain POSIX path alone', () => {
    expect(escapeDroppedPath('/Users/me/shot.png', 'darwin')).toBe('/Users/me/shot.png');
  });

  it('backslash-escapes spaces and shell characters, never quoting', () => {
    expect(escapeDroppedPath('/Users/me/Screen Shot (2).png', 'darwin')).toBe(
      '/Users/me/Screen\\ Shot\\ \\(2\\).png',
    );
    expect(escapeDroppedPath("/tmp/it's $x&y.txt", 'linux')).toBe("/tmp/it\\'s\\ \\$x\\&y.txt");
  });

  it('keeps non-ASCII characters as they are', () => {
    expect(escapeDroppedPath('/Users/me/Skærmbillede.png', 'darwin')).toBe(
      '/Users/me/Skærmbillede.png',
    );
  });

  it('double-quotes a Windows path only when it needs it', () => {
    expect(escapeDroppedPath('C:\\Users\\me\\shot.png', 'win32')).toBe('C:\\Users\\me\\shot.png');
    expect(escapeDroppedPath('C:\\Users\\me\\my shot.png', 'win32')).toBe(
      '"C:\\Users\\me\\my shot.png"',
    );
  });
});

describe('droppedPathsText', () => {
  it('joins the paths with spaces and ends with one, inside the paste', () => {
    expect(droppedPathsText(['/a/one.png', '/b/two words.txt'], 'darwin')).toBe(
      '/a/one.png /b/two\\ words.txt ',
    );
  });

  it('skips items without a path, and gives null when none has one', () => {
    expect(droppedPathsText(['', '/a/x'], 'darwin')).toBe('/a/x ');
    expect(droppedPathsText(['', ''], 'darwin')).toBeNull();
    expect(droppedPathsText([], 'darwin')).toBeNull();
  });
});
