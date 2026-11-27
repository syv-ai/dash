/**
 * Coarse buckets for analytics (docs/telemetry.md): no event carries a count
 * or timing precise enough to fingerprint an install.
 */

/** A duration in ms. */
export function durationBucket(ms: number): string {
  if (ms < 10_000) return 'lt_10s';
  if (ms < 60_000) return '10s_1m';
  if (ms < 5 * 60_000) return '1m_5m';
  if (ms < 15 * 60_000) return '5m_15m';
  if (ms < 60 * 60_000) return '15m_1h';
  return 'gt_1h';
}

/** A count (projects, tasks, sessions, tool calls). One, two-three and four-five stay apart: that is where parallel work shows. */
export function countBucket(n: number): string {
  if (!(n >= 1)) return '0';
  if (n < 2) return '1';
  if (n <= 3) return '2_3';
  if (n <= 5) return '4_5';
  if (n <= 10) return '6_10';
  if (n <= 20) return '11_20';
  if (n <= 50) return '21_50';
  return 'gt_50';
}

/** Minutes in a day. */
export function minutesBucket(minutes: number): string {
  if (!(minutes >= 1)) return '0';
  if (minutes < 15) return 'lt_15m';
  if (minutes < 60) return '15m_1h';
  if (minutes < 120) return '1h_2h';
  if (minutes < 240) return '2h_4h';
  if (minutes < 480) return '4h_8h';
  return 'gt_8h';
}

/** Memory in bytes, in GB bands. */
export function memoryBucket(bytes: number): string {
  const gb = bytes / 1024 ** 3;
  if (!(gb >= 2)) return 'lt_2gb';
  if (gb < 4) return '2_4gb';
  if (gb < 8) return '4_8gb';
  if (gb < 16) return '8_16gb';
  if (gb < 32) return '16_32gb';
  return 'gt_32gb';
}
