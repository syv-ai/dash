import type { Terminal, ILinkProvider, ILink, IBufferRange } from 'xterm';

// File extensions to match — strong false-positive guard
const EXTENSIONS =
  'ts|tsx|js|jsx|mjs|cjs|json|md|mdx|py|rb|rs|go|java|kt|swift|c|cpp|h|hpp|css|scss|less|html|xml|yaml|yml|toml|sql|sh|bash|zsh|vue|svelte|astro|graphql|gql|proto|prisma|env|lock|txt|csv|log|conf|cfg|ini|makefile|dockerfile';

// Matches file paths with at least one `/`, a known extension, and optional :line:col
// Preceded by start-of-string, whitespace, or punctuation boundary (avoids matching inside URLs)
const FILE_PATH_RE = new RegExp(
  `(?:^|(?<=[\\s(\\[{'\`",:]))` + // boundary: start or whitespace/punctuation
    `(\\.{0,2}/` + // start with optional ./ or ../ or just /
    `[\\w.@/-]+` + // path chars (letters, digits, dots, @, hyphens, slashes)
    `\\.(?:${EXTENSIONS})` + // require known extension
    `(?::(\\d+)(?::(\\d+))?)?)`, // optional :line:col
  'gi',
);

interface ParsedLink {
  text: string;
  filePath: string;
  line?: number;
  col?: number;
  startIndex: number;
  endIndex: number;
}

function parseLinksFromText(lineText: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  FILE_PATH_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = FILE_PATH_RE.exec(lineText)) !== null) {
    const fullMatch = match[0];
    const startIndex = match.index;

    // Extract line:col from the match groups
    const line = match[2] ? parseInt(match[2], 10) : undefined;
    const col = match[3] ? parseInt(match[3], 10) : undefined;

    // The file path is the match without the :line:col suffix
    const colonSuffix =
      col != null ? `:${match[2]}:${match[3]}` : line != null ? `:${match[2]}` : '';
    const filePath = fullMatch.slice(0, fullMatch.length - colonSuffix.length);

    links.push({
      text: fullMatch,
      filePath,
      line,
      col,
      startIndex,
      endIndex: startIndex + fullMatch.length,
    });
  }

  return links;
}

export class FilePathLinkProvider implements ILinkProvider {
  constructor(
    private terminal: Terminal,
    private getCwd: () => string,
    private onOpen: (filePath: string, line?: number, col?: number) => void,
  ) {}

  provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
    const buffer = this.terminal.buffer.active;
    const line = buffer.getLine(bufferLineNumber - 1);
    if (!line) {
      callback(undefined);
      return;
    }

    // Skip continuation lines (wrapped) — only process the first line of a wrapped sequence
    if (bufferLineNumber > 1) {
      const prevLine = buffer.getLine(bufferLineNumber - 2);
      if (prevLine && prevLine.isWrapped) {
        // This line IS a continuation — but we want to skip if THIS line is wrapped
      }
    }
    if (line.isWrapped) {
      callback(undefined);
      return;
    }

    // Collect full unwrapped line text (this line + any continuation lines below)
    let lineText = line.translateToString(true);
    let wrappedLines = 0;
    let nextLineIdx = bufferLineNumber; // 0-based: bufferLineNumber is already the next
    while (nextLineIdx < buffer.length) {
      const nextLine = buffer.getLine(nextLineIdx);
      if (!nextLine || !nextLine.isWrapped) break;
      lineText += nextLine.translateToString(true);
      wrappedLines++;
      nextLineIdx++;
    }

    const parsed = parseLinksFromText(lineText);
    if (parsed.length === 0) {
      callback(undefined);
      return;
    }

    const cols = this.terminal.cols;
    const links: ILink[] = parsed.map((p) => {
      // Calculate buffer range accounting for wrapped lines
      const startRow = bufferLineNumber + Math.floor(p.startIndex / cols);
      const startCol = (p.startIndex % cols) + 1; // 1-based
      const endOffset = p.endIndex - 1;
      const endRow = bufferLineNumber + Math.floor(endOffset / cols);
      const endCol = (endOffset % cols) + 1; // 1-based

      const range: IBufferRange = {
        start: { x: startCol, y: startRow },
        end: { x: endCol, y: endRow },
      };

      return {
        range,
        text: p.text,
        activate: () => {
          this.onOpen(p.filePath, p.line, p.col);
        },
      };
    });

    callback(links);
  }
}
