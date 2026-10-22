/** POSIX single-quote a shell word: `'` → `'\''`. Safe for any value passed through sh. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
