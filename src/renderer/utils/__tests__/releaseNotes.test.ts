import { describe, it, expect } from 'vitest';
import {
  compareVersions,
  normalizeVersion,
  releaseUrl,
  shouldShowReleaseNotes,
} from '../releaseNotes';

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
    expect(compareVersions('0.13.0', '0.12.9')).toBe(1);
    expect(compareVersions('0.13.1', '0.13.0')).toBe(1);
    expect(compareVersions('0.13.0', '0.13.1')).toBe(-1);
    expect(compareVersions('0.13.0', '0.13.0')).toBe(0);
  });

  it('tolerates a leading v and the .DEV / pre-release suffix', () => {
    expect(compareVersions('v0.13.0', '0.13.0')).toBe(0);
    expect(compareVersions('0.13.0.DEV', '0.13.0')).toBe(0);
    expect(compareVersions('0.14.0-beta.1', '0.13.0')).toBe(1);
  });

  it('treats missing or malformed parts as 0', () => {
    expect(compareVersions('0.13', '0.13.0')).toBe(0);
    expect(compareVersions('garbage', '0.0.0')).toBe(0);
    expect(compareVersions('1', '0.99.99')).toBe(1);
  });
});

describe('normalizeVersion', () => {
  it('strips the v prefix and any suffix to a clean major.minor.patch', () => {
    expect(normalizeVersion('v0.13.0')).toBe('0.13.0');
    expect(normalizeVersion('0.13.0.DEV')).toBe('0.13.0');
    expect(normalizeVersion('0.14.0-beta.1')).toBe('0.14.0');
    expect(normalizeVersion('0.13')).toBe('0.13.0');
  });
});

describe('shouldShowReleaseNotes', () => {
  it('is false on a fresh install (no last-seen version)', () => {
    expect(shouldShowReleaseNotes('0.13.0', undefined)).toBe(false);
  });

  it('is true only when the running version is strictly newer', () => {
    expect(shouldShowReleaseNotes('0.13.0', '0.12.0')).toBe(true);
    expect(shouldShowReleaseNotes('0.13.0', '0.13.0')).toBe(false);
    expect(shouldShowReleaseNotes('0.12.0', '0.13.0')).toBe(false);
  });

  it('ignores a dev .DEV suffix when comparing', () => {
    expect(shouldShowReleaseNotes('0.13.0.DEV', '0.13.0')).toBe(false);
    expect(shouldShowReleaseNotes('0.14.0.DEV', '0.13.0')).toBe(true);
  });
});

describe('releaseUrl', () => {
  it('builds the GitHub release tag URL with a normalized version', () => {
    expect(releaseUrl('0.13.0')).toBe('https://github.com/syv-ai/dash/releases/tag/v0.13.0');
    expect(releaseUrl('v0.13.0')).toBe('https://github.com/syv-ai/dash/releases/tag/v0.13.0');
    expect(releaseUrl('0.13.0.DEV')).toBe('https://github.com/syv-ai/dash/releases/tag/v0.13.0');
  });
});
