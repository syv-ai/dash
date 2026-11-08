import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { userDataDir } from '../userDataDir';

const appData = '/Users/x/Library/Application Support';

describe('userDataDir', () => {
  it("keeps the default (the installed app's folder) for a packaged run", () => {
    expect(userDataDir({}, true, appData)).toBeNull();
  });

  it('gives an unpackaged run its own Dash-dev folder', () => {
    expect(userDataDir({}, false, appData)).toBe(path.join(appData, 'Dash-dev'));
  });

  it('lets DASH_USER_DATA_DIR win, packaged or not', () => {
    const env = { DASH_USER_DATA_DIR: '/tmp/dash-b' };
    expect(userDataDir(env, false, appData)).toBe('/tmp/dash-b');
    expect(userDataDir(env, true, appData)).toBe('/tmp/dash-b');
  });

  it('resolves a relative DASH_USER_DATA_DIR', () => {
    expect(userDataDir({ DASH_USER_DATA_DIR: 'data' }, false, appData)).toBe(path.resolve('data'));
  });

  it('ignores an empty DASH_USER_DATA_DIR', () => {
    expect(userDataDir({ DASH_USER_DATA_DIR: '' }, false, appData)).toBe(
      path.join(appData, 'Dash-dev'),
    );
  });
});
