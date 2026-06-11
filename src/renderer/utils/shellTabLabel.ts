/**
 * Next label for a new shell tab: one past the highest numeric label in the
 * drawer. Counting tabs instead would collide after a close (close "1" of
 * ["1","2"], add → another "2"). Non-numeric labels (service/tui tabs) are
 * ignored.
 */
export function nextShellLabel(labels: string[]): string {
  const highest = labels.reduce((max, label) => {
    const n = /^\d+$/.test(label) ? parseInt(label, 10) : 0;
    return Math.max(max, n);
  }, 0);
  return String(highest + 1);
}
