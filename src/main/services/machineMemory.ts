/*
 * The machine's available memory, the honest figure per platform. A free
 * page count alone misleads: an OS fills idle RAM with file cache it hands
 * back on demand, so "free" sits near zero on a healthy machine.
 *
 * - macOS: free + file-backed (external) + purgeable pages. Activity Monitor's
 *   Memory Used is App Memory (anonymous − purgeable) + Wired + Compressed;
 *   physical memory less that leaves exactly these three. Read from `sysctl`
 *   in the same call as the pressure level, so it costs no extra process.
 * - Linux: `/proc/meminfo` `MemAvailable` (the kernel's own estimate of what
 *   can be allocated without swapping), a file read.
 * - Windows: `os.freemem()`, which libuv takes from `GlobalMemoryStatusEx`'s
 *   available physical memory (free + standby list).
 */
import type { MachineMemory } from '@shared/systemHealth';

/** What the macOS sample asks `sysctl` for: the pressure level, then the
 *  page counts the available figure sums. */
export const DARWIN_SYSCTL_NAMES = [
  'kern.memorystatus_vm_pressure_level',
  'hw.memsize',
  'vm.pagesize',
  'vm.page_free_count',
  'vm.page_pageable_external_count',
  'vm.page_purgeable_count',
] as const;

/** `sysctl a b c` output ("name: value" per line) as numbers by name. An
 *  unknown name prints nothing on stdout, so the rest still read. */
export function parseSysctl(stdout: string): Map<string, number> {
  const values = new Map<string, number>();
  for (const line of stdout.split('\n')) {
    const [, name, value] = /^([\w.]+):\s*(\d+)$/.exec(line.trim()) ?? [];
    if (name && value) values.set(name, Number(value));
  }
  return values;
}

/** macOS: free + file cache + purgeable pages, against `hw.memsize`; null
 *  when a count is missing. */
export function darwinMachineMemory(values: ReadonlyMap<string, number>): MachineMemory | null {
  const total = values.get('hw.memsize');
  const page = values.get('vm.pagesize');
  const free = values.get('vm.page_free_count');
  const external = values.get('vm.page_pageable_external_count');
  const purgeable = values.get('vm.page_purgeable_count');
  if (!total || !page || free === undefined || external === undefined || purgeable === undefined) {
    return null;
  }
  return {
    totalBytes: total,
    availableBytes: Math.min(total, (free + external + purgeable) * page),
  };
}

/** Linux `/proc/meminfo`: `MemTotal` and `MemAvailable` (kB); null on a
 *  kernel without `MemAvailable` (before 3.14). */
export function parseMeminfo(text: string): MachineMemory | null {
  const kb = (key: string): number | undefined => {
    const m = new RegExp(`^${key}:\\s+(\\d+)\\s*kB`, 'm').exec(text);
    return m ? Number(m[1]) * 1024 : undefined;
  };
  const totalBytes = kb('MemTotal');
  const availableBytes = kb('MemAvailable');
  if (!totalBytes || availableBytes === undefined) return null;
  return { totalBytes, availableBytes: Math.min(totalBytes, availableBytes) };
}
