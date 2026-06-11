/** A codec maps a typed setting value to/from its localStorage string form.
 *  `decode` receives null when the key is absent and must return a default. */
export interface Codec<T> {
  decode: (raw: string | null) => T;
  encode: (value: T) => string;
}

/** Raw string value; `def` used when the key is absent. */
export function str(def: string): Codec<string> {
  return { decode: (raw) => (raw === null ? def : raw), encode: (v) => v };
}

/** Boolean stored as 'true'/'false', defaulting to true when the key is absent.
 *  Matches the legacy `stored === null ? true : stored === 'true'` idiom. */
export function boolDefaultTrue(): Codec<boolean> {
  return { decode: (raw) => (raw === null ? true : raw === 'true'), encode: (v) => String(v) };
}

/** Boolean stored as 'true'/'false', defaulting to false when absent.
 *  Matches the legacy `stored === 'true'` idiom. */
export function boolDefaultFalse(): Codec<boolean> {
  return { decode: (raw) => raw === 'true', encode: (v) => String(v) };
}

/** Boolean defaulting to true unless explicitly 'false'.
 *  Matches the legacy `stored !== 'false'` idiom. */
export function boolNotFalse(): Codec<boolean> {
  return { decode: (raw) => raw !== 'false', encode: (v) => String(v) };
}

/** String constrained to `allowed`; invalid/absent values fall back to `def`. */
export function strEnum<T extends string>(allowed: readonly T[], def: T): Codec<T> {
  return {
    decode: (raw) => (raw !== null && allowed.includes(raw as T) ? (raw as T) : def),
    encode: (v) => v,
  };
}
