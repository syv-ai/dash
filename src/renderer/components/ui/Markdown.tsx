import { memo, useMemo, type ReactNode } from 'react';
import { marked, type Token, type Tokens } from 'marked';

/**
 * Markdown (GitHub-flavoured) rendered as React elements from marked's tokens,
 * never as an HTML string: text written by anyone (a PR's other reviewers, an
 * agent) can't inject markup. Raw HTML in the source is dropped, keeping its
 * text. Long lines and code wrap rather than scroll sideways. Links open in the
 * browser.
 */
export const Markdown = memo(function Markdown({
  text,
  className = '',
}: {
  text: string;
  className?: string;
}) {
  const tokens = useMemo(() => marked.lexer(text, { gfm: true, breaks: true }), [text]);
  return (
    <div className={`min-w-0 wrap-break-word [&>*+*]:mt-1.5 ${className}`}>{blocks(tokens)}</div>
  );
});

/** `&amp;` → `&`, for entities the source spelled out. Safe: a DOMParser
 *  document runs no scripts and loads nothing. */
function decode(s: string): string {
  if (!s.includes('&')) return s;
  return new DOMParser().parseFromString(s, 'text/html').documentElement.textContent ?? s;
}

const stripTags = (html: string) =>
  decode(html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ''));

function openLink(href: string) {
  if (/^https?:\/\//i.test(href)) void window.electronAPI.openExternal(href);
}

function blocks(tokens: Token[]): ReactNode[] {
  return tokens.map((t, i) => block(t, i));
}

function block(t: Token, key: number): ReactNode {
  switch (t.type) {
    case 'space':
    case 'def':
      return null;
    case 'paragraph':
      return <p key={key}>{inline((t as Tokens.Paragraph).tokens)}</p>;
    case 'heading': {
      const h = t as Tokens.Heading;
      return (
        <p key={key} className={`font-semibold ${h.depth <= 2 ? 'text-[1.1em]' : ''}`}>
          {inline(h.tokens)}
        </p>
      );
    }
    case 'code': {
      const c = t as Tokens.Code;
      return (
        <div key={key}>
          {c.lang === 'suggestion' && (
            <div className="text-[10.5px] text-muted-fade-70">Suggested change</div>
          )}
          <pre className="whitespace-pre-wrap break-all rounded-md bg-foreground/6 px-2 py-1.5 font-mono text-[11px] leading-snug">
            {c.text}
          </pre>
        </div>
      );
    }
    case 'blockquote':
      return (
        <blockquote
          key={key}
          className="border-l-2 border-edge/25 pl-2 text-fg-fade-70 [&>*+*]:mt-1.5"
        >
          {blocks((t as Tokens.Blockquote).tokens)}
        </blockquote>
      );
    case 'list': {
      const l = t as Tokens.List;
      const items = l.items.map((item, i) => (
        <li key={i} className={item.task ? 'list-none -ml-4' : ''}>
          {item.task && (
            <input
              type="checkbox"
              checked={!!item.checked}
              readOnly
              className="mr-1.5 align-middle"
            />
          )}
          {item.tokens.map((c, j) =>
            c.type === 'checkbox' ? null : c.type === 'text' ? (
              <span key={j}>{inline((c as Tokens.Text).tokens ?? [c])}</span>
            ) : (
              block(c, j)
            ),
          )}
        </li>
      ));
      return l.ordered ? (
        <ol key={key} start={l.start === '' ? undefined : l.start} className="list-decimal pl-4">
          {items}
        </ol>
      ) : (
        <ul key={key} className="list-disc pl-4">
          {items}
        </ul>
      );
    }
    case 'table': {
      const tb = t as Tokens.Table;
      const cell = (c: Tokens.TableCell, i: number, head: boolean) => {
        const Tag = head ? 'th' : 'td';
        return (
          <Tag
            key={i}
            className={`border border-edge/15 px-1.5 py-0.5 text-left align-top ${head ? 'font-semibold' : ''}`}
          >
            {inline(c.tokens)}
          </Tag>
        );
      };
      return (
        <table key={key} className="w-full table-fixed border-collapse text-[0.95em]">
          <thead>
            <tr>{tb.header.map((c, i) => cell(c, i, true))}</tr>
          </thead>
          <tbody>
            {tb.rows.map((row, r) => (
              <tr key={r}>{row.map((c, i) => cell(c, i, false))}</tr>
            ))}
          </tbody>
        </table>
      );
    }
    case 'hr':
      return <hr key={key} className="border-edge/15" />;
    case 'html': {
      const text = stripTags((t as Tokens.HTML).text).trim();
      return text ? <p key={key}>{text}</p> : null;
    }
    case 'text': {
      const tx = t as Tokens.Text;
      return <p key={key}>{tx.tokens ? inline(tx.tokens) : decode(tx.text)}</p>;
    }
    default:
      return 'tokens' in t && t.tokens ? <p key={key}>{inline(t.tokens)}</p> : null;
  }
}

function inline(tokens: Token[]): ReactNode[] {
  return tokens.map((t, i) => {
    switch (t.type) {
      case 'text': {
        const tx = t as Tokens.Text;
        return tx.tokens ? <span key={i}>{inline(tx.tokens)}</span> : decode(tx.text);
      }
      case 'escape':
        return (t as Tokens.Escape).text;
      case 'strong':
        return (
          <strong key={i} className="font-semibold">
            {inline((t as Tokens.Strong).tokens)}
          </strong>
        );
      case 'em':
        return <em key={i}>{inline((t as Tokens.Em).tokens)}</em>;
      case 'del':
        return <del key={i}>{inline((t as Tokens.Del).tokens)}</del>;
      case 'codespan':
        return (
          <code
            key={i}
            className="rounded-[3px] bg-foreground/8 px-1 py-px font-mono text-[0.92em] break-all"
          >
            {(t as Tokens.Codespan).text}
          </code>
        );
      case 'br':
        return <br key={i} />;
      case 'link':
      case 'image': {
        const l = t as Tokens.Link | Tokens.Image;
        return (
          <a
            key={i}
            href={l.href}
            title={l.href}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openLink(l.href);
            }}
            className="text-primary underline-offset-2 hover:underline break-all"
          >
            {t.type === 'image' ? l.text || l.href : inline(l.tokens)}
          </a>
        );
      }
      case 'html':
        return /^<br\s*\/?>$/i.test((t as Tokens.HTML).text.trim()) ? <br key={i} /> : null;
      default:
        return 'tokens' in t && t.tokens ? <span key={i}>{inline(t.tokens)}</span> : t.raw;
    }
  });
}
