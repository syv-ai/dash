import { describe, expect, it } from 'vitest';
import type { MemoryPressure } from '@shared/systemHealth';
import {
  COOLDOWN_MS,
  INITIAL_ALERT_STATE,
  parsePressureLevel,
  stepAlert,
  type AlertReason,
  type AlertState,
} from '../memoryAlertState';

const T = 1000;

/** Feed samples (total, pressure?, at minute) and collect the warnings. */
function run(samples: Array<[number, MemoryPressure | null, number]>): Array<AlertReason | null> {
  let state: AlertState = INITIAL_ALERT_STATE;
  return samples.map(([totalBytes, pressure, minute]) => {
    const step = stepAlert(state, {
      totalBytes,
      thresholdBytes: T,
      pressure,
      now: minute * 60_000,
    });
    state = step.state;
    return step.alert;
  });
}

describe('stepAlert', () => {
  it('stays quiet under the threshold', () => {
    expect(
      run([
        [500, 'normal', 0],
        [999, null, 1],
      ]),
    ).toEqual([null, null]);
  });

  it('warns once on the way up and not again while over', () => {
    expect(
      run([
        [900, 'normal', 0],
        [1000, 'normal', 1],
        [1500, 'normal', 2],
        [1200, null, 3],
      ]),
    ).toEqual([null, 'threshold', null, null]);
  });

  it('does not re-arm on a dip that stays above 90%', () => {
    expect(
      run([
        [1100, null, 0],
        [950, null, 1],
        [1100, null, 2],
      ]),
    ).toEqual(['threshold', null, null]);
  });

  it('re-arms below 90% and warns on the next crossing', () => {
    expect(
      run([
        [1100, null, 0],
        [850, null, 1],
        [1050, null, 2],
      ]),
    ).toEqual(['threshold', null, 'threshold']);
  });

  it('warns on OS pressure below the threshold', () => {
    expect(
      run([
        [300, 'warn', 0],
        [300, 'critical', 1],
      ]),
    ).toEqual(['pressure', null]);
  });

  it('names the threshold when both hold', () => {
    expect(run([[1200, 'critical', 0]])).toEqual(['threshold']);
  });

  it('stays disarmed while pressure lasts, even under 90%', () => {
    expect(
      run([
        [300, 'warn', 0],
        [300, 'warn', 1],
        [300, 'normal', 2],
        [300, 'warn', 3],
      ]),
    ).toEqual(['pressure', null, null, 'pressure']);
  });

  it('repeats after the cool-down while still over', () => {
    const cool = COOLDOWN_MS / 60_000;
    expect(
      run([
        [1100, null, 0],
        [1100, null, cool - 1],
        [1100, null, cool],
      ]),
    ).toEqual(['threshold', null, 'threshold']);
  });
});

describe('parsePressureLevel', () => {
  it.each([
    ['1\n', 'normal'],
    ['2', 'warn'],
    ['4', 'critical'],
    ['0', null],
    ['', null],
  ])('%j → %s', (out, level) => {
    expect(parsePressureLevel(out)).toBe(level);
  });
});
