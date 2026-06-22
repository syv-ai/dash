import { describe, it, expect } from 'vitest';
import { IpcError, errorResponse, ipcError } from '../ipcErrors';

describe('IpcError', () => {
  it('is an Error carrying a code', () => {
    const e = new IpcError('nope', 'NOT_FOUND');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('IpcError');
    expect(e.message).toBe('nope');
    expect(e.code).toBe('NOT_FOUND');
  });
});

describe('errorResponse', () => {
  it('uses an IpcError code and its plain message', () => {
    expect(errorResponse(new IpcError('bad args', 'VALIDATION'))).toEqual({
      success: false,
      error: 'bad args',
      code: 'VALIDATION',
    });
  });

  it('maps a plain Error to UNKNOWN with no "Error:" prefix', () => {
    expect(errorResponse(new Error('boom'))).toEqual({
      success: false,
      error: 'boom',
      code: 'UNKNOWN',
    });
  });

  it('stringifies a non-Error value as UNKNOWN', () => {
    expect(errorResponse('plain reason')).toEqual({
      success: false,
      error: 'plain reason',
      code: 'UNKNOWN',
    });
  });
});

describe('ipcError', () => {
  it('builds an explicit coded failure response', () => {
    expect(ipcError('Task x not found', 'NOT_FOUND')).toEqual({
      success: false,
      error: 'Task x not found',
      code: 'NOT_FOUND',
    });
  });
});
