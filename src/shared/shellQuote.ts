/** POSIX single-quote a shell word: `'` → `'\''`. Safe for any value passed through sh. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export type ShellSplitResult = { ok: true; words: string[] } | { ok: false; error: string };

/** Unquoted, these would make a shell run something else; here they're refused. */
const OPERATORS = new Set(['|', '&', ';', '<', '>', '(', ')']);

/**
 * Split a command line into words the way a POSIX shell quotes them, and do
 * nothing else: no expansion, no globbing, no operators. The inverse of
 * `shellQuote`. Single quotes keep everything; double quotes keep everything
 * but `\` before `$`, `` ` ``, `"`, `\` or a newline; outside quotes `\`
 * keeps the next character (and `\` + newline joins lines).
 *
 * What a shell would expand is refused rather than passed on as typed,
 * because what reaches the program would not be what the person meant:
 * an unquoted `$` or `` ` ``, a word starting with an unquoted `~`, and an
 * unquoted operator (`|`, `&`, `;`, `<`, `>`, `(`, `)`). Quote any of them
 * to pass it literally.
 */
export function shellSplit(input: string): ShellSplitResult {
  const words: string[] = [];
  let word = '';
  // A word exists once anything (even `''`) was read for it.
  let inWord = false;
  let i = 0;
  const fail = (error: string): ShellSplitResult => ({ ok: false, error });

  while (i < input.length) {
    const c = input[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      if (inWord) words.push(word);
      word = '';
      inWord = false;
      i++;
      continue;
    }
    if (c === "'") {
      const end = input.indexOf("'", i + 1);
      if (end < 0) return fail('A single quote is never closed.');
      word += input.slice(i + 1, end);
      inWord = true;
      i = end + 1;
      continue;
    }
    if (c === '"') {
      i++;
      let closed = false;
      while (i < input.length) {
        const d = input[i]!;
        if (d === '"') {
          closed = true;
          i++;
          break;
        }
        if (d === '\\' && i + 1 < input.length && '$`"\\\n'.includes(input[i + 1]!)) {
          if (input[i + 1] !== '\n') word += input[i + 1];
          i += 2;
          continue;
        }
        if (d === '$' || d === '`') {
          return fail(`${d} isn't expanded here; use single quotes to pass it as is.`);
        }
        word += d;
        i++;
      }
      if (!closed) return fail('A double quote is never closed.');
      inWord = true;
      continue;
    }
    if (c === '\\') {
      if (i + 1 >= input.length) return fail('A backslash ends the line with nothing to escape.');
      if (input[i + 1] !== '\n') {
        word += input[i + 1];
        inWord = true;
      }
      i += 2;
      continue;
    }
    if (c === '$' || c === '`') {
      return fail(`${c} isn't expanded here; quote it to pass it as is, or write the value.`);
    }
    if (c === '~' && !inWord) {
      return fail('~ isn\'t expanded here; write the full path, or quote it to pass "~".');
    }
    if (OPERATORS.has(c)) {
      return fail(`${c} is a shell operator, which isn't supported here; quote it to pass it.`);
    }
    word += c;
    inWord = true;
    i++;
  }
  if (inWord) words.push(word);
  return { ok: true, words };
}
