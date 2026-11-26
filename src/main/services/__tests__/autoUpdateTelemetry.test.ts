import { describe, expect, it } from 'vitest';
import { installedUpdate, UpdateTelemetry, updateErrorCode } from '../autoUpdateTelemetry';

describe('UpdateTelemetry', () => {
  it('reports an available and a downloaded update once per version, with both versions', () => {
    const t = new UpdateTelemetry('0.25.0');
    const versions = { from_version: '0.25.0', to_version: '0.26.0' };
    expect(t.available('0.26.0')).toEqual({ event: 'app_update_available', properties: versions });
    expect(t.available('0.26.0')).toBeNull();
    expect(t.downloaded('0.26.0')).toEqual({
      event: 'app_update_downloaded',
      properties: versions,
    });
    expect(t.downloaded('0.26.0')).toBeNull();
    expect(t.available('0.26.1')?.properties.to_version).toBe('0.26.1');
  });

  it('reports a failure by stage and code, once per pair', () => {
    const t = new UpdateTelemetry('0.25.0');
    const offline = Object.assign(new Error('net::ERR_INTERNET_DISCONNECTED'), {
      code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
    });
    expect(t.failed('checking', offline, null)).toEqual({
      event: 'app_update_failed',
      properties: {
        stage: 'check',
        error_code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
        from_version: '0.25.0',
      },
    });
    expect(t.failed('checking', offline, null)).toBeNull();
    expect(t.failed('downloading', new Error('x'), '0.26.0')).toEqual({
      event: 'app_update_failed',
      properties: {
        stage: 'download',
        error_code: 'unknown',
        from_version: '0.25.0',
        to_version: '0.26.0',
      },
    });
    expect(t.failed('ready', new Error('x'), '0.26.0')?.properties.stage).toBe('install');
    expect(t.failed('idle', new Error('x'), null)?.properties.stage).toBe('check');
  });
});

describe('updateErrorCode', () => {
  it('keeps an identifier-shaped code and drops anything else', () => {
    expect(updateErrorCode({ code: 'ENOTFOUND' })).toBe('ENOTFOUND');
    expect(updateErrorCode({ code: '/Users/me/Library/x' })).toBe('unknown');
    expect(updateErrorCode({ code: 42 })).toBe('unknown');
    expect(updateErrorCode('boom')).toBe('unknown');
  });
});

describe('installedUpdate', () => {
  it('reports a launch on another version than the last one', () => {
    expect(installedUpdate('0.25.0', '0.26.0')).toEqual({
      event: 'app_update_installed',
      properties: { from_version: '0.25.0', to_version: '0.26.0' },
    });
  });

  it('says nothing on a first launch or the same version', () => {
    expect(installedUpdate(undefined, '0.26.0')).toBeNull();
    expect(installedUpdate('0.26.0', '0.26.0')).toBeNull();
  });
});
