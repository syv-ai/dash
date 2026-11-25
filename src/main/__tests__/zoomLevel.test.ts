import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ZOOM_LEVEL, nextZoomLevel, readZoomLevel, writeZoomLevel } from '../zoomLevel';

describe('nextZoomLevel', () => {
  it('steps by Chromium half levels', () => {
    expect(nextZoomLevel(0.5, 'in')).toBe(1);
    expect(nextZoomLevel(0.5, 'out')).toBe(0);
  });

  it('resets to the default, one step in, not to 0', () => {
    expect(DEFAULT_ZOOM_LEVEL).toBe(0.5);
    expect(nextZoomLevel(3, 'reset')).toBe(0.5);
  });

  it('stays within bounds', () => {
    expect(nextZoomLevel(5, 'in')).toBe(5);
    expect(nextZoomLevel(-3, 'out')).toBe(-3);
  });
});

describe('readZoomLevel / writeZoomLevel', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-zoom-'));
  const file = path.join(dir, 'zoom.json');
  afterEach(() => fs.rmSync(file, { force: true }));

  it('opens at the default with nothing stored', () => {
    expect(readZoomLevel(file)).toBe(DEFAULT_ZOOM_LEVEL);
  });

  it('keeps the user level, zero included', () => {
    writeZoomLevel(file, 0);
    expect(readZoomLevel(file)).toBe(0);
    writeZoomLevel(file, 1.5);
    expect(readZoomLevel(file)).toBe(1.5);
  });

  it('falls back to the default on a corrupt file and clamps a wild one', () => {
    fs.writeFileSync(file, '{oops');
    expect(readZoomLevel(file)).toBe(DEFAULT_ZOOM_LEVEL);
    fs.writeFileSync(file, JSON.stringify({ level: 40 }));
    expect(readZoomLevel(file)).toBe(5);
  });
});
