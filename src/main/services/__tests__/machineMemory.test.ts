import { describe, expect, it } from 'vitest';
import {
  DARWIN_SYSCTL_NAMES,
  darwinMachineMemory,
  parseMeminfo,
  parseSysctl,
} from '../machineMemory';

const GB = 1024 ** 3;

/** A live `sysctl` of DARWIN_SYSCTL_NAMES on a 36 GB Mac (2026-11-28). */
const DARWIN = [
  'kern.memorystatus_vm_pressure_level: 1',
  'hw.memsize: 38654705664',
  'vm.pagesize: 16384',
  'vm.page_free_count: 96446',
  'vm.page_pageable_external_count: 573868',
  'vm.page_purgeable_count: 28138',
].join('\n');

describe('parseSysctl', () => {
  it('reads each name and value', () => {
    const v = parseSysctl(DARWIN);
    expect(v.get('kern.memorystatus_vm_pressure_level')).toBe(1);
    expect(v.get('vm.pagesize')).toBe(16384);
    expect(v.size).toBe(DARWIN_SYSCTL_NAMES.length);
  });

  it('skips an unknown name and anything not "name: integer"', () => {
    const v = parseSysctl(
      "sysctl: unknown oid 'vm.bogus'\nvm.pagesize: 4096\nvm.swapusage: total = 2048.00M\n",
    );
    expect([...v]).toEqual([['vm.pagesize', 4096]]);
  });
});

describe('darwinMachineMemory', () => {
  it('counts free, file cache and purgeable pages as available', () => {
    const m = darwinMachineMemory(parseSysctl(DARWIN));
    expect(m).toEqual({
      totalBytes: 38654705664,
      availableBytes: (96446 + 573868 + 28138) * 16384,
    });
    expect(m!.availableBytes / GB).toBeCloseTo(10.66, 1);
  });

  it('is null when a count is missing', () => {
    const v = parseSysctl(DARWIN);
    v.delete('vm.page_pageable_external_count');
    expect(darwinMachineMemory(v)).toBeNull();
  });

  it('never reports more available than installed', () => {
    const v = parseSysctl(DARWIN);
    v.set('vm.page_free_count', 10_000_000);
    expect(darwinMachineMemory(v)!.availableBytes).toBe(38654705664);
  });
});

describe('parseMeminfo', () => {
  const MEMINFO = [
    'MemTotal:       16314700 kB',
    'MemFree:          812340 kB',
    'MemAvailable:    9876544 kB',
    'Buffers:          301220 kB',
  ].join('\n');

  it('reads MemTotal and MemAvailable, not MemFree', () => {
    expect(parseMeminfo(MEMINFO)).toEqual({
      totalBytes: 16314700 * 1024,
      availableBytes: 9876544 * 1024,
    });
  });

  it('is null without MemAvailable (a pre-3.14 kernel)', () => {
    expect(parseMeminfo('MemTotal: 16314700 kB\nMemFree: 812340 kB\n')).toBeNull();
  });
});
