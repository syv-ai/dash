import React from 'react';
import { highlightBlock } from './highlightCode';

interface MarkdownRendererProps {
  content: string;
}

/**
 * Lightweight markdown renderer for chat messages.
 * Handles: fenced code blocks, inline code, bold, italic, links, lists, headings.
 */
export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const blocks = parseBlocks(content);
  return <div className="markdown-content">{blocks.map((block, i) => renderBlock(block, i))}</div>;
}

type Block =
  | { type: 'code'; lang: string; code: string }
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fenceMatch = line.match(/^```(\w*)/);
    if (fenceMatch) {
      const lang = fenceMatch[1] || '';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: 'code', lang, code: codeLines.join('\n') });
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      i++;
      continue;
    }

    // Unordered list
    if (line.match(/^\s*[-*]\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\s*[-*]\s+/)) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    // Ordered list
    if (line.match(/^\s*\d+\.\s+/)) {
      const items: string[] = [];
      while (i < lines.length && lines[i].match(/^\s*\d+\.\s+/)) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    // Table: header row | separator row | data rows
    if (
      line.includes('|') &&
      i + 1 < lines.length &&
      lines[i + 1].match(/^\s*\|?\s*[-:]+[-|:\s]*$/)
    ) {
      const parseRow = (r: string) =>
        r
          .split('|')
          .map((c) => c.trim())
          .filter((_, idx, arr) => idx > 0 || arr[0] !== '');
      const headers = parseRow(line);
      // Remove trailing empty cell if row ended with |
      if (headers.length > 0 && headers[headers.length - 1] === '') headers.pop();
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|')) {
        const row = parseRow(lines[i]);
        if (row.length > 0 && row[row.length - 1] === '') row.pop();
        rows.push(row);
        i++;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Paragraph: collect consecutive non-empty, non-special lines
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !lines[i].match(/^```/) &&
      !lines[i].match(/^#{1,6}\s+/) &&
      !lines[i].match(/^\s*[-*]\s+/) &&
      !lines[i].match(/^\s*\d+\.\s+/) &&
      !(
        lines[i].includes('|') &&
        i + 1 < lines.length &&
        lines[i + 1]?.match(/^\s*\|?\s*[-:]+[-|:\s]*$/)
      )
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: 'paragraph', text: paraLines.join('\n') });
    }
  }

  return blocks;
}

function renderBlock(block: Block, key: number): React.ReactNode {
  switch (block.type) {
    case 'code': {
      const highlighted = highlightBlock(block.code, block.lang || undefined);
      return (
        <div key={key} className="my-2 rounded-md overflow-hidden border border-border/60">
          {block.lang && (
            <div className="px-3 py-1 text-[10px] font-mono text-muted-foreground bg-surface-1 border-b border-border/40">
              {block.lang}
            </div>
          )}
          <pre className="p-3 text-[12px] font-mono leading-relaxed overflow-x-auto bg-surface-0">
            <code dangerouslySetInnerHTML={{ __html: highlighted }} />
          </pre>
        </div>
      );
    }

    case 'heading': {
      const sizes = [
        'text-lg font-bold',
        'text-base font-bold',
        'text-sm font-semibold',
        'text-sm font-semibold',
        'text-xs font-semibold',
        'text-xs font-semibold',
      ];
      return (
        <div key={key} className={`${sizes[block.level - 1]} mt-3 mb-1 text-foreground`}>
          {renderInline(block.text)}
        </div>
      );
    }

    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag
          key={key}
          className={`my-1.5 pl-5 text-[13px] leading-relaxed ${block.ordered ? 'list-decimal' : 'list-disc'}`}
        >
          {block.items.map((item, j) => (
            <li key={j} className="text-foreground/90">
              {renderInline(item)}
            </li>
          ))}
        </Tag>
      );
    }

    case 'table':
      return (
        <div key={key} className="my-2 overflow-x-auto rounded-md border border-border/60">
          <table className="w-full text-[12px]">
            <thead>
              <tr
                className="border-b border-border/60"
                style={{ background: 'hsl(var(--surface-1))' }}
              >
                {block.headers.map((h, j) => (
                  <th key={j} className="px-3 py-1.5 text-left font-semibold text-foreground/80">
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, j) => (
                <tr
                  key={j}
                  className="border-b border-border/30 last:border-0"
                  style={{ background: j % 2 === 0 ? 'hsl(var(--surface-0))' : 'transparent' }}
                >
                  {row.map((cell, k) => (
                    <td key={k} className="px-3 py-1.5 text-foreground/80">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case 'paragraph':
      return (
        <p key={key} className="my-1.5 text-[13px] leading-relaxed text-foreground/90">
          {renderInline(block.text)}
        </p>
      );
  }
}

/** Convert newlines in plain text to <br> elements. */
function textWithBreaks(str: string): React.ReactNode {
  const segments = str.split('\n');
  if (segments.length === 1) return str;
  return segments.map((s, i) => (
    <React.Fragment key={i}>
      {s}
      {i < segments.length - 1 && <br />}
    </React.Fragment>
  ));
}

/** Check if a string looks like a file path (contains / or \ and ends with a file extension). */
function isFilePath(str: string): boolean {
  return /^[\w./\\-]+\.\w{1,10}(:\d+)?$/.test(str) && (str.includes('/') || str.includes('\\'));
}

/** Handle clicking a file path link — opens in the user's preferred editor. */
function handleFileClick(filePath: string) {
  const [path, lineStr] = filePath.split(':');
  const line = lineStr ? parseInt(lineStr, 10) : undefined;
  window.electronAPI.openInEditor({ cwd: '', filePath: path, line });
}

/** Render inline markdown: bold, italic, inline code, links, bare URLs, file paths. */
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // Regex for: `code`, **bold**, *italic*, [text](url), bare URLs, file_path:line
  const regex =
    /(`[^`]+`|\*\*.+?\*\*|\*[^*]+?\*|\[[^\]]+\]\([^)]+\)|https?:\/\/[^\s)>\]]+|(?:[\w./\\-]+\/[\w./\\-]+\.\w{1,10}(?::\d+)?))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(textWithBreaks(text.slice(lastIndex, match.index)));
    }

    const token = match[0];
    if (token.startsWith('`')) {
      // Inline code — check if content is a file path
      const inner = token.slice(1, -1);
      if (isFilePath(inner)) {
        parts.push(
          <code
            key={match.index}
            className="px-1 py-0.5 rounded bg-surface-1 text-[12px] font-mono text-primary cursor-pointer hover:underline"
            onClick={() => handleFileClick(inner)}
          >
            {inner}
          </code>,
        );
      } else {
        parts.push(
          <code
            key={match.index}
            className="px-1 py-0.5 rounded bg-surface-1 text-[12px] font-mono text-foreground/80"
          >
            {inner}
          </code>,
        );
      }
    } else if (token.startsWith('**')) {
      parts.push(
        <strong key={match.index} className="font-semibold">
          {renderInline(token.slice(2, -2))}
        </strong>,
      );
    } else if (token.startsWith('*')) {
      parts.push(
        <em key={match.index} className="italic">
          {renderInline(token.slice(1, -1))}
        </em>,
      );
    } else if (token.startsWith('[')) {
      const linkMatch = token.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        const href = linkMatch[2];
        parts.push(
          <a
            key={match.index}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
            onClick={(e) => {
              e.preventDefault();
              window.electronAPI.openExternal(href);
            }}
          >
            {renderInline(linkMatch[1])}
          </a>,
        );
      }
    } else if (token.startsWith('http')) {
      // Bare URL
      parts.push(
        <a
          key={match.index}
          href={token}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
          onClick={(e) => {
            e.preventDefault();
            window.electronAPI.openExternal(token);
          }}
        >
          {token}
        </a>,
      );
    } else if (isFilePath(token)) {
      // Bare file path
      parts.push(
        <span
          key={match.index}
          className="font-mono text-primary cursor-pointer hover:underline"
          onClick={() => handleFileClick(token)}
        >
          {token}
        </span>,
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(textWithBreaks(text.slice(lastIndex)));
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
