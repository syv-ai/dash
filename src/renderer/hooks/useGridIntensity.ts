import { useEffect, useState, useCallback } from 'react';
import { DEFAULT_GRID_INTENSITY_G_PER_KWH } from '../../shared/carbon';

const STORAGE_KEY = 'carbonGridIntensity';

function read(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  const parsed = stored !== null ? Number(stored) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GRID_INTENSITY_G_PER_KWH;
}

/**
 * Grid carbon intensity (gCO2e/kWh) used to convert estimated energy to carbon.
 * Backed by localStorage and synced across components/windows via the storage event.
 */
export function useGridIntensity(): [number, (value: number) => void] {
  const [intensity, setIntensity] = useState<number>(read);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setIntensity(read());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const update = useCallback((value: number) => {
    const safe = Number.isFinite(value) && value > 0 ? value : DEFAULT_GRID_INTENSITY_G_PER_KWH;
    localStorage.setItem(STORAGE_KEY, String(safe));
    setIntensity(safe);
    // Same-window listeners (storage event only fires cross-window).
    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEY, newValue: String(safe) }));
  }, []);

  return [intensity, update];
}
