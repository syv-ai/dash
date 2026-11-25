import { describe, expect, it } from 'vitest';
import {
  HEADER_COMFORT_PX as comfort,
  HEADER_GAP_PX as gap,
  HEADER_LABELS,
  NAME_MIN_PX,
  fitTaskHeader,
  hiddenLabelCount,
  labelShows,
} from '../headerFit';

// tokens, model, setup, linked, branch, pr
const widths = [40, 90, 70, 36, 120, 28];
const need = (from: number, name = NAME_MIN_PX) =>
  name + widths.slice(from).reduce((sum, w) => sum + (w > 0 ? w + gap : 0), 0) + comfort;

describe('hiddenLabelCount', () => {
  it('shows every label while they fit beside the name at its minimum', () => {
    expect(hiddenLabelCount(need(0), 300, widths)).toBe(0);
  });

  it('hides the token count first, one pixel short', () => {
    expect(hiddenLabelCount(need(0) - 1, 300, widths)).toBe(1);
  });

  it('then one at a time in order, the pull request last', () => {
    expect(hiddenLabelCount(need(1) - 1, 300, widths)).toBe(2);
    expect(hiddenLabelCount(need(2) - 1, 300, widths)).toBe(3);
    expect(hiddenLabelCount(need(4), 300, widths)).toBe(4);
    expect(hiddenLabelCount(need(4) - 1, 300, widths)).toBe(5);
    expect(hiddenLabelCount(need(5) - 1, 300, widths)).toBe(6);
  });

  it('reserves only the name it has when it is shorter than the minimum', () => {
    expect(hiddenLabelCount(need(0, 60), 60, widths)).toBe(0);
  });

  it('charges no gap for a label that is not there', () => {
    const absent = [40, 90, 0, 0, 120, 28];
    const room = NAME_MIN_PX + 40 + 90 + 120 + 28 + 4 * gap + comfort;
    expect(hiddenLabelCount(room, 300, absent)).toBe(0);
    expect(hiddenLabelCount(room, 300, [40, 90, 1, 0, 120, 28])).toBe(1);
  });
});

describe('fitTaskHeader', () => {
  it('reads the name first, then the labels', () => {
    expect(fitTaskHeader(need(0), [300, ...widths])).toBe(0);
    expect(fitTaskHeader(need(0) - 1, [300, ...widths])).toBe(1);
  });
});

describe('labelShows', () => {
  it('drops labels in the given order', () => {
    expect(HEADER_LABELS).toEqual(['tokens', 'model', 'setup', 'linked', 'branch', 'pr']);
    expect(labelShows('tokens', 1)).toBe(false);
    expect(labelShows('model', 1)).toBe(true);
    expect(labelShows('pr', 5)).toBe(true);
    expect(labelShows('pr', 6)).toBe(false);
  });
});
