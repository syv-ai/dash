import type { ParsedSessionMessage, TokenUsage } from './sessionTypes';
import { formatCarbon, formatEnergy } from './format';

/**
 * Energy & carbon estimation for Claude Code token usage.
 *
 * Methodology adapted from the claude-carbon project
 * (https://github.com/metztim/claude-carbon, MIT). The coefficients are rough
 * estimates inferred from pricing ratios and public research, NOT measured
 * figures; surface them as estimates in any UI.
 *
 * Formula:  tokens × J/token × PUE = Joules → /3600 = Wh → × gCO2e/kWh / 1000 = grams
 *
 * energyWh depends only on the (fixed) per-model energy + PUE coefficients, so it
 * is computed wherever messages are available. gramsCO2e scales linearly with the
 * grid carbon intensity, which is user-configurable — keep that conversion separate
 * (see {@link carbonGramsFromWh}) so callers can apply the user's intensity.
 */

export type CarbonModel = 'opus' | 'sonnet' | 'haiku';

/** All energy families, in display order. Single source of truth for the union. */
export const CARBON_MODELS: CarbonModel[] = ['opus', 'sonnet', 'haiku'];

/** Joules per token per model family (rough estimate). */
export const MODEL_ENERGY_J_PER_TOKEN: Record<CarbonModel, number> = {
  opus: 2.0,
  sonnet: 1.0,
  haiku: 0.3,
};

/** Fallback when a model string doesn't match a known family. */
export const DEFAULT_CARBON_MODEL: CarbonModel = 'sonnet';

/** Zeroed per-family token buckets. Factory (callers mutate the result). */
export function emptyTokensByModel(): Record<CarbonModel, number> {
  return { opus: 0, sonnet: 0, haiku: 0 };
}

/** Power Usage Effectiveness — datacenter overhead multiplier. */
export const PUE = 1.2;

/** US grid average 2024, gCO2e/kWh (EPA). User-overridable. */
export const DEFAULT_GRID_INTENSITY_G_PER_KWH = 384;

/**
 * Cache tokens are weighted relative to a normal input token before being charged
 * at the model's J/token rate:
 *  - cache read: 0.1× (retrieval, minimal compute)
 *  - cache creation: 1.25× (extra work to store)
 */
const CACHE_READ_WEIGHT = 0.1;
const CACHE_CREATION_WEIGHT = 1.25;

const JOULES_PER_WH = 3600;
const WH_PER_KWH = 1000;

/** Map a Claude model id (e.g. "claude-opus-4-8") to its energy family. */
export function normalizeModel(model: string | undefined): CarbonModel {
  if (!model) return DEFAULT_CARBON_MODEL;
  const m = model.toLowerCase();
  if (m.includes('opus')) return 'opus';
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('sonnet')) return 'sonnet';
  return DEFAULT_CARBON_MODEL;
}

/**
 * Effective token count for one message's usage, weighting cache reads/creations.
 * = baseInput + round(cacheRead·0.1) + round(cacheCreate·1.25) + output
 * (cache weights are rounded per-message).
 */
export function effectiveTokens(usage: TokenUsage | undefined): number {
  if (!usage) return 0;
  const baseInput = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheCreate = usage.cache_creation_input_tokens ?? 0;
  return (
    baseInput +
    Math.round(cacheRead * CACHE_READ_WEIGHT) +
    Math.round(cacheCreate * CACHE_CREATION_WEIGHT) +
    output
  );
}

/** Energy (Wh) for a number of effective tokens at a model's rate, including PUE. */
export function energyWhForTokens(tokens: number, model: CarbonModel): number {
  const joules = tokens * MODEL_ENERGY_J_PER_TOKEN[model] * PUE;
  return joules / JOULES_PER_WH;
}

/** Convert energy (Wh) to carbon (grams CO2e) at a grid intensity (gCO2e/kWh). */
export function carbonGramsFromWh(
  energyWh: number,
  gridIntensity: number = DEFAULT_GRID_INTENSITY_G_PER_KWH,
): number {
  return (energyWh * gridIntensity) / WH_PER_KWH;
}

export interface EnergyStats {
  /** Effective (cache-weighted) token total. */
  tokens: number;
  energyWh: number;
  /** Effective tokens grouped by model family, for breakdowns. */
  tokensByModel: Record<CarbonModel, number>;
}

/**
 * Aggregate energy across messages, charging each message's effective tokens at
 * its own model's rate. Non-assistant messages (no usage) contribute nothing.
 */
export function computeEnergyFromMessages(messages: ParsedSessionMessage[]): EnergyStats {
  let tokens = 0;
  let energyWh = 0;
  const tokensByModel = emptyTokensByModel();

  for (const msg of messages) {
    if (!msg.usage) continue;
    const t = effectiveTokens(msg.usage);
    if (t === 0) continue;
    const model = normalizeModel(msg.model);
    tokens += t;
    tokensByModel[model] += t;
    energyWh += energyWhForTokens(t, model);
  }

  return { tokens, energyWh, tokensByModel };
}

/** Sum a list of energy stats (e.g. across sessions/projects). */
export function sumEnergyStats(stats: EnergyStats[]): EnergyStats {
  return stats.reduce<EnergyStats>(
    (acc, s) => ({
      tokens: acc.tokens + s.tokens,
      energyWh: acc.energyWh + s.energyWh,
      tokensByModel: {
        opus: acc.tokensByModel.opus + s.tokensByModel.opus,
        sonnet: acc.tokensByModel.sonnet + s.tokensByModel.sonnet,
        haiku: acc.tokensByModel.haiku + s.tokensByModel.haiku,
      },
    }),
    { tokens: 0, energyWh: 0, tokensByModel: emptyTokensByModel() },
  );
}

/**
 * Average emissions of commercial air travel, gCO2e per passenger-km. Economy-class
 * order-of-magnitude estimate (roughly DEFRA short-haul, excluding radiative forcing)
 * — a ballpark like the other coefficients here, not a precise figure.
 */
export const FLIGHT_G_CO2E_PER_KM = 150;

/** Relatable carbon comparison expressed as distance flown. Input is grams CO2e. */
export function flightComparison(gramsCO2e: number): string {
  const km = gramsCO2e / FLIGHT_G_CO2E_PER_KM;
  if (km < 1) return `Flying ${Math.round(km * 1000)} m`;
  if (km < 1000) return `Flying ${km.toFixed(km < 10 ? 1 : 0)} km`;
  return `Flying ${(km / 1000).toFixed(1)}k km`;
}

/**
 * Relatable energy comparison. Input is energy in Wh.
 */
export function householdComparison(energyWh: number): string {
  if (energyWh < 0.01) return '< 1 sec of an LED bulb';
  if (energyWh < 0.1) return `LED bulb for ${Math.floor(energyWh / 0.01)}s`;
  if (energyWh < 1.0) return `LED bulb for ${Math.floor(energyWh * 10)}s`;
  if (energyWh < 10.0) {
    const percent = energyWh * 0.05;
    return `Phone charge ${percent < 1 ? percent.toFixed(1) : percent.toFixed(0)}%`;
  }
  if (energyWh < 100.0) return `Laptop for ${Math.floor((energyWh / 10.0) * 5)} min`;
  if (energyWh < 1000.0) {
    const hours = energyWh / 100.0;
    return hours < 1
      ? `Laptop for ${Math.floor(hours * 60)} min`
      : `Laptop for ${hours.toFixed(1)} hrs`;
  }
  if (energyWh < 30000.0) {
    const percent = Math.floor(energyWh / 300.0);
    return percent < 100
      ? `${percent}% of daily home use`
      : `${(energyWh / 30000.0).toFixed(1)} days of home power`;
  }
  if (energyWh < 100000.0) return `${(energyWh / 30000.0).toFixed(1)} days of home power`;
  return `EV for ${Math.floor((energyWh / 1000.0) * 3.5)} miles`;
}

export interface CarbonDisplay {
  /** Carbon mass in grams CO2e at the given grid intensity. */
  grams: number;
  /** Formatted carbon, e.g. "12 g" / "1.3 kg". */
  carbon: string;
  /** Formatted energy, e.g. "50 Wh" / "1.5 kWh". */
  energy: string;
  /** Relatable carbon comparison ("Flying 5.0 km"). */
  flight: string;
  /** Relatable energy comparison ("Laptop for 2 min"). */
  household: string;
}

/**
 * Derive every display string for an energy figure in one place, so the carbon
 * panel and the inline usage widget can't drift in how they apply grid intensity
 * or phrase comparisons.
 */
export function carbonDisplay(energyWh: number, gridIntensity?: number): CarbonDisplay {
  const grams = carbonGramsFromWh(energyWh, gridIntensity);
  return {
    grams,
    carbon: formatCarbon(grams),
    energy: formatEnergy(energyWh),
    flight: flightComparison(grams),
    household: householdComparison(energyWh),
  };
}
