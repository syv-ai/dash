import { describe, it, expect } from 'vitest';
import {
  normalizeModel,
  effectiveTokens,
  energyWhForTokens,
  carbonGramsFromWh,
  computeEnergyFromMessages,
  sumEnergyStats,
  householdComparison,
  flightComparison,
  FLIGHT_G_CO2E_PER_KM,
  PUE,
  MODEL_ENERGY_J_PER_TOKEN,
  DEFAULT_GRID_INTENSITY_G_PER_KWH,
} from '../carbon';
import type { ParsedSessionMessage } from '../sessionTypes';

function msg(partial: Partial<ParsedSessionMessage>): ParsedSessionMessage {
  return {
    uuid: 'u',
    parentUuid: null,
    type: 'assistant',
    timestamp: '2025-01-01T00:00:00Z',
    content: '',
    isSidechain: false,
    isMeta: false,
    toolCalls: [],
    toolResults: [],
    ...partial,
  };
}

describe('normalizeModel', () => {
  it('maps Claude model ids to energy families', () => {
    expect(normalizeModel('claude-opus-4-8')).toBe('opus');
    expect(normalizeModel('claude-sonnet-4-6')).toBe('sonnet');
    expect(normalizeModel('claude-haiku-4-5-20251001')).toBe('haiku');
  });

  it('falls back to sonnet for unknown / missing models', () => {
    expect(normalizeModel(undefined)).toBe('sonnet');
    expect(normalizeModel('some-other-model')).toBe('sonnet');
  });
});

describe('effectiveTokens', () => {
  it('returns 0 for missing usage', () => {
    expect(effectiveTokens(undefined)).toBe(0);
  });

  it('sums base input + weighted cache + output (read 0.1x, create 1.25x)', () => {
    // 100 + round(1000*0.1)=100 + round(200*1.25)=250 + 50 = 500
    expect(
      effectiveTokens({
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 200,
      }),
    ).toBe(500);
  });
});

describe('energy & carbon math', () => {
  it('matches the documented formula tokens × J/token × PUE / 3600', () => {
    // 3600 sonnet tokens (1 J/token) × PUE 1.2 = 4320 J = 1.2 Wh
    const wh = energyWhForTokens(3600, 'sonnet');
    expect(wh).toBeCloseTo((3600 * MODEL_ENERGY_J_PER_TOKEN.sonnet * PUE) / 3600, 6);
    expect(wh).toBeCloseTo(1.2, 6);
  });

  it('opus costs 2x sonnet, haiku 0.3x, for the same tokens', () => {
    expect(energyWhForTokens(1000, 'opus')).toBeCloseTo(energyWhForTokens(1000, 'sonnet') * 2, 6);
    expect(energyWhForTokens(1000, 'haiku')).toBeCloseTo(
      energyWhForTokens(1000, 'sonnet') * 0.3,
      6,
    );
  });

  it('converts Wh to grams CO2e at the grid intensity', () => {
    expect(carbonGramsFromWh(1000)).toBeCloseTo(DEFAULT_GRID_INTENSITY_G_PER_KWH, 6);
    expect(carbonGramsFromWh(1000, 500)).toBeCloseTo(500, 6);
  });
});

describe('computeEnergyFromMessages', () => {
  it('charges each message at its own model rate and groups tokens by model', () => {
    const stats = computeEnergyFromMessages([
      msg({ model: 'claude-opus-4-8', usage: { input_tokens: 100, output_tokens: 0 } }),
      msg({ model: 'claude-haiku-4-5', usage: { input_tokens: 100, output_tokens: 0 } }),
      msg({ type: 'user', usage: undefined }),
    ]);
    expect(stats.tokens).toBe(200);
    expect(stats.tokensByModel).toEqual({ opus: 100, sonnet: 0, haiku: 100 });
    expect(stats.energyWh).toBeCloseTo(
      energyWhForTokens(100, 'opus') + energyWhForTokens(100, 'haiku'),
      6,
    );
  });
});

describe('sumEnergyStats', () => {
  it('adds tokens, energy, and per-model breakdowns', () => {
    const a = computeEnergyFromMessages([
      msg({ model: 'claude-opus-4-8', usage: { input_tokens: 10, output_tokens: 0 } }),
    ]);
    const b = computeEnergyFromMessages([
      msg({ model: 'claude-sonnet-4-6', usage: { input_tokens: 20, output_tokens: 0 } }),
    ]);
    const total = sumEnergyStats([a, b]);
    expect(total.tokens).toBe(30);
    expect(total.tokensByModel).toEqual({ opus: 10, sonnet: 20, haiku: 0 });
  });
});

describe('flightComparison', () => {
  it('scales from metres to thousands of km', () => {
    // 15 g / 150 g·km⁻¹ = 0.1 km → 100 m
    expect(flightComparison(15)).toBe('Flying 100 m');
    expect(flightComparison(FLIGHT_G_CO2E_PER_KM * 5)).toBe('Flying 5.0 km');
    expect(flightComparison(FLIGHT_G_CO2E_PER_KM * 250)).toBe('Flying 250 km');
    expect(flightComparison(FLIGHT_G_CO2E_PER_KM * 5000)).toBe('Flying 5.0k km');
  });
});

describe('householdComparison', () => {
  it('scales units with magnitude', () => {
    expect(householdComparison(0.005)).toContain('LED bulb');
    expect(householdComparison(5)).toContain('Phone charge');
    expect(householdComparison(50)).toContain('Laptop');
    expect(householdComparison(5000)).toContain('home');
    expect(householdComparison(500000)).toContain('EV');
  });
});
