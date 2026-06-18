export function formatTokens(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

export function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function formatEnergy(wh: number): string {
  if (wh >= 1000) return `${(wh / 1000).toFixed(1)} kWh`;
  if (wh >= 1) return `${wh.toFixed(0)} Wh`;
  if (wh <= 0) return '0 Wh';
  return `${wh.toFixed(2)} Wh`;
}

export function formatCarbon(grams: number): string {
  if (grams >= 1000) return `${(grams / 1000).toFixed(1)} kg`;
  if (grams >= 1) return `${grams.toFixed(0)} g`;
  if (grams <= 0) return '0 g';
  return `${grams.toFixed(1)} g`;
}

export function formatResetTime(epochSeconds: number): string {
  if (!epochSeconds) return '';
  const diffMs = epochSeconds * 1000 - Date.now();
  if (diffMs <= 0) return 'now';
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 60) return `in ${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `in ${diffH}h ${diffMin % 60}m`;
  const diffD = Math.floor(diffH / 24);
  const remH = diffH % 24;
  return remH > 0 ? `in ${diffD}d ${remH}h` : `in ${diffD}d`;
}
