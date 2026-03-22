import React from 'react';

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
  | { type: 'list'; ordered: boolean; items: string[] };

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
      !lines[i].match(/^\s*\d+\.\s+/)
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
    case 'code':
      return (
        <div key={key} className="my-2 rounded-md overflow-hidden border border-border/60">
          {block.lang && (
            <div className="px-3 py-1 text-[10px] font-mono text-muted-foreground bg-surface-1 border-b border-border/40">
              {block.lang}
            </div>
          )}
          <pre className="p-3 text-[12px] font-mono leading-relaxed overflow-x-auto bg-surface-0">
            <code>{block.code}</code>
          </pre>
        </div>
      );

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

    case 'paragraph':
      return (
        <p key={key} className="my-1.5 text-[13px] leading-relaxed text-foreground/90">
          {renderInline(block.text)}
        </p>
      );
  }
}

/** Render inline markdown: bold, italic, inline code, links. Recurses for nested formatting. */
function renderInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  // Regex for: `code`, **bold**, *italic*, [text](url)
  // Use .+? for bold/italic to allow nested inline tokens inside
  const regex = /(`[^`]+`|\*\*.+?\*\*|\*[^*]+?\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('`')) {
      // Inline code — no recursion, render literally
      parts.push(
        <code
          key={match.index}
          className="px-1 py-0.5 rounded bg-surface-1 text-[12px] font-mono text-foreground/80"
        >
          {token.slice(1, -1)}
        </code>,
      );
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
        parts.push(
          <a
            key={match.index}
            href={linkMatch[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {renderInline(linkMatch[1])}
          </a>,
        );
      }
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
