import type { TokenUsage } from '../../shared/sessionTypes';

type ModelFamily = 'opus' | 'sonnet' | 'haiku';

interface Rates {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWriteMultiplier: number;
}

const RATES: Record<ModelFamily, Rates> = {
  opus: { inputPerMTok: 15, outputPerMTok: 75, cacheReadPerMTok: 1.5, cacheWriteMultiplier: 1.25 },
  sonnet: { inputPerMTok: 3, outputPerMTok: 15, cacheReadPerMTok: 0.3, cacheWriteMultiplier: 1.25 },
  haiku: { inputPerMTok: 1, outputPerMTok: 5, cacheReadPerMTok: 0.1, cacheWriteMultiplier: 1.25 },
};

export function resolveModelFamily(modelId: string | undefined): ModelFamily {
  if (!modelId) return 'sonnet';
  const id = modelId.toLowerCase();
  if (id.includes('opus')) return 'opus';
  if (id.includes('haiku')) return 'haiku';
  return 'sonnet';
}

export function computeCostUsd(usage: TokenUsage | undefined, modelId: string | undefined): number {
  if (!usage) return 0;
  const r = RATES[resolveModelFamily(modelId)];
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  return (
    (input * r.inputPerMTok) / 1_000_000 +
    (output * r.outputPerMTok) / 1_000_000 +
    (cacheRead * r.cacheReadPerMTok) / 1_000_000 +
    (cacheWrite * r.inputPerMTok * r.cacheWriteMultiplier) / 1_000_000
  );
}
