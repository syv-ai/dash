import hljs from 'highlight.js/lib/core';

// Register common languages
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import markdown from 'highlight.js/lib/languages/markdown';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import diff from 'highlight.js/lib/languages/diff';
import shell from 'highlight.js/lib/languages/shell';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('css', css);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('go', go);
hljs.registerLanguage('java', java);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('shell', shell);

// Aliases
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('tsx', typescript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('jsx', javascript);
hljs.registerLanguage('py', python);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('zsh', bash);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('md', markdown);
hljs.registerLanguage('htm', xml);
hljs.registerLanguage('rs', rust);

/** Map file extensions to highlight.js language names. */
const EXT_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  json: 'json',
  jsonl: 'json',
  css: 'css',
  scss: 'css',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  md: 'markdown',
  yaml: 'yaml',
  yml: 'yaml',
  sql: 'sql',
  rs: 'rust',
  go: 'go',
  java: 'java',
  diff: 'diff',
};

/** Get the highlight.js language for a file path or extension. */
export function langFromPath(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? EXT_MAP[ext] : undefined;
}

/**
 * Highlight a single line of code, returning HTML string.
 * Uses continuation to maintain state across lines for multi-line tokens.
 */
export function highlightLine(
  line: string,
  lang: string | undefined,
  continuation?: { top?: any },
): { html: string; top?: any } {
  if (!lang) return { html: escapeHtml(line) };
  try {
    const result = hljs.highlight(line, {
      language: lang,
      ignoreIllegals: true,
    });
    return { html: result.value, top: result._top };
  } catch {
    return { html: escapeHtml(line) };
  }
}

/**
 * Highlight a block of code, returning HTML string.
 */
export function highlightBlock(code: string, lang?: string): string {
  if (!lang) {
    try {
      const result = hljs.highlightAuto(code);
      return result.value;
    } catch {
      return escapeHtml(code);
    }
  }
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
