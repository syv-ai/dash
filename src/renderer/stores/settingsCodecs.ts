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

/** number | null, where `null` (and the legacy `'null'` string) means "unset";
 *  a non-numeric stored value falls back to `fallback`. A stored `0` is kept as
 *  0 (not coerced to the fallback the way `parseInt(raw) || fallback` would). */
export function nullableInt(fallback: number): Codec<number | null> {
  return {
    decode: (raw) => {
      if (raw === null || raw === 'null') return null;
      const n = parseInt(raw, 10);
      return Number.isNaN(n) ? fallback : n;
    },
    encode: (v) => String(v),
  };
}

/** string | undefined, where an absent key decodes to undefined (the "default").
 *  Empty string and other values are preserved verbatim. */
export function strOrUndefined(): Codec<string | undefined> {
  return {
    decode: (raw) => (raw === null ? undefined : raw),
    encode: (v) => v ?? '',
  };
}

/** Set<string> stored as a JSON string array. Parse failure → empty Set. */
export function stringSet(): Codec<Set<string>> {
  return {
    decode: (raw) => {
      if (raw === null) return new Set();
      try {
        const arr: unknown = JSON.parse(raw);
        return Array.isArray(arr)
          ? new Set(arr.filter((x): x is string => typeof x === 'string'))
          : new Set();
      } catch {
        return new Set();
      }
    },
    encode: (v) => JSON.stringify([...v]),
  };
}

/** JSON value with parse-failure fallback to `def`. An optional `validate`
 *  predicate rejects structurally-wrong parsed values (falling back to `def`). */
export function json<T>(def: T, validate?: (v: unknown) => boolean): Codec<T> {
  return {
    decode: (raw) => {
      if (raw === null) return def;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (validate && !validate(parsed)) return def;
        return parsed as T;
      } catch {
        return def;
      }
    },
    encode: (v) => JSON.stringify(v),
  };
}
