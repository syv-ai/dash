import { describe, expect, it } from 'vitest';
import { isExternalWebUrl, mayNavigate } from '../navigation';

describe('isExternalWebUrl', () => {
  it('lets web and mail links out', () => {
    expect(isExternalWebUrl('https://github.com/syv-ai/dash')).toBe(true);
    expect(isExternalWebUrl('http://localhost:3000')).toBe(true);
    expect(isExternalWebUrl('mailto:someone@example.com')).toBe(true);
  });

  it('keeps every other scheme in', () => {
    for (const url of [
      'file:///Applications/Calculator.app',
      'javascript:alert(1)',
      'vscode://file/etc/passwd',
      'about:srcdoc#top',
      'not a url',
    ]) {
      expect(isExternalWebUrl(url)).toBe(false);
    }
  });
});

describe('mayNavigate', () => {
  const app = 'http://localhost:3000/';

  it('keeps the window on the page it loaded', () => {
    expect(mayNavigate('http://localhost:3000/#x', true, app)).toBe(true);
    expect(mayNavigate('https://example.com/', true, app)).toBe(false);
    expect(mayNavigate('file:///Users/me/dropped.html', true, app)).toBe(false);
    expect(mayNavigate(app, true, '')).toBe(false);
  });

  it('lets a preview frame load its document and go nowhere else', () => {
    expect(mayNavigate('about:srcdoc', false, app)).toBe(true);
    expect(mayNavigate('about:blank', false, app)).toBe(true);
    expect(mayNavigate('https://example.com/', false, app)).toBe(false);
    expect(mayNavigate(app, false, app)).toBe(false);
  });
});
