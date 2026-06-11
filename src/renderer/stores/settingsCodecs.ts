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
