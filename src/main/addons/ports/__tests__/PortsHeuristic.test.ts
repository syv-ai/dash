import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { detectPortsNeed } from '../PortsHeuristic';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-heuristic-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const abs = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

describe('detectPortsNeed — negative', () => {
  it('returns needsPorts:false for an empty project', () => {
    const result = detectPortsNeed(tmpDir);
    expect(result).toEqual({ needsPorts: false, signals: [], guesses: [] });
  });

  it('ignores a package.json with no relevant frameworks', () => {
    write('package.json', JSON.stringify({ dependencies: { lodash: '*' } }));
    expect(detectPortsNeed(tmpDir).needsPorts).toBe(false);
  });

  it('handles a malformed package.json without throwing', () => {
    write('package.json', '{ not valid json');
    expect(detectPortsNeed(tmpDir).needsPorts).toBe(false);
  });
});

describe('detectPortsNeed — node frameworks (signal only, no auto-guess)', () => {
  it('detects vite from devDependencies as a signal', () => {
    write('package.json', JSON.stringify({ devDependencies: { vite: '^5.0.0' } }));
    const result = detectPortsNeed(tmpDir);
    expect(result.needsPorts).toBe(true);
    expect(result.signals[0]).toMatch(/vite/);
    // No auto-guess: framework defaults are unreliable (Vite's 5173 is often
    // overridden in vite.config.ts). Agent reads the real port at setup time.
    expect(result.guesses).toEqual([]);
  });

  it('detects next from dependencies as a signal', () => {
    write('package.json', JSON.stringify({ dependencies: { next: '^14.0.0' } }));
    const result = detectPortsNeed(tmpDir);
    expect(result.needsPorts).toBe(true);
    expect(result.signals[0]).toMatch(/next/);
    expect(result.guesses).toEqual([]);
  });

  it('detects @sveltejs/kit as a signal', () => {
    write('package.json', JSON.stringify({ devDependencies: { '@sveltejs/kit': '^2.0.0' } }));
    const result = detectPortsNeed(tmpDir);
    expect(result.needsPorts).toBe(true);
    expect(result.signals[0]).toMatch(/@sveltejs\/kit/);
    expect(result.guesses).toEqual([]);
  });
});

describe('detectPortsNeed — python frameworks (signal only, no auto-guess)', () => {
  it('detects fastapi in requirements.txt as a signal', () => {
    write('requirements.txt', 'fastapi==0.110.0\nuvicorn[standard]\n');
    const result = detectPortsNeed(tmpDir);
    expect(result.needsPorts).toBe(true);
    expect(result.signals[0]).toMatch(/fastapi/);
    expect(result.guesses).toEqual([]);
  });

  it('detects flask in pyproject.toml as a signal', () => {
    write('pyproject.toml', '[tool.poetry.dependencies]\nflask = "^3.0"\n');
    const result = detectPortsNeed(tmpDir);
    expect(result.needsPorts).toBe(true);
    expect(result.signals[0]).toMatch(/flask/);
    expect(result.guesses).toEqual([]);
  });
});

describe('detectPortsNeed — docker-compose', () => {
  it('extracts services and their first port', () => {
    write(
      'docker-compose.yml',
      [
        'services:',
        '  api:',
        '    image: my/api',
        '    ports:',
        '      - "8000:8000"',
        '  web:',
        '    image: my/web',
        '    ports:',
        '      - "5173:5173"',
        '  db:',
        '    image: postgres',
        '    ports:',
        '      - "5432:5432"',
        '',
      ].join('\n'),
    );
    const result = detectPortsNeed(tmpDir);
    expect(result.needsPorts).toBe(true);
    expect(result.signals[0]).toMatch(/api, web, db/);
    expect(result.guesses).toEqual([
      { label: 'Api', envVar: 'API_PORT', defaultPort: 8000 },
      { label: 'Web', envVar: 'WEB_PORT', defaultPort: 5173 },
      { label: 'Db', envVar: 'DB_PORT', defaultPort: 5432 },
    ]);
  });

  it('handles published-only port notation (no host mapping)', () => {
    write(
      'docker-compose.yml',
      ['services:', '  api:', '    ports:', '      - "8080"', ''].join('\n'),
    );
    expect(detectPortsNeed(tmpDir).guesses).toEqual([
      { label: 'Api', envVar: 'API_PORT', defaultPort: 8080 },
    ]);
  });

  it('accepts compose.yaml as a sibling filename', () => {
    write('compose.yaml', ['services:', '  api:', '    ports:', '      - "9000:9000"'].join('\n'));
    expect(detectPortsNeed(tmpDir).guesses).toEqual([
      { label: 'Api', envVar: 'API_PORT', defaultPort: 9000 },
    ]);
  });

  it('reports compose file even with no published ports', () => {
    write('docker-compose.yml', ['services:', '  api:', '    image: alpine'].join('\n'));
    const result = detectPortsNeed(tmpDir);
    expect(result.needsPorts).toBe(true);
    expect(result.signals[0]).toMatch(/no published ports/);
    expect(result.guesses).toEqual([]);
  });
});

describe('detectPortsNeed — Dockerfile EXPOSE', () => {
  it('captures exposed ports without auto-guessing labels', () => {
    write('Dockerfile', 'FROM node:22\nEXPOSE 3000 8080/tcp\n');
    const result = detectPortsNeed(tmpDir);
    expect(result.needsPorts).toBe(true);
    expect(result.signals.some((s) => s.includes('3000') && s.includes('8080'))).toBe(true);
    // Bare EXPOSE shouldn't seed guesses — names are too generic.
    expect(result.guesses).toEqual([]);
  });

  it('reports Dockerfile without EXPOSE as a signal', () => {
    write('Dockerfile', 'FROM alpine\n');
    const result = detectPortsNeed(tmpDir);
    expect(result.needsPorts).toBe(true);
    expect(result.signals[0]).toBe('Dockerfile (no EXPOSE)');
  });
});

describe('detectPortsNeed — combined signals', () => {
  it('keeps only compose-derived guesses when a framework is also detected', () => {
    write(
      'docker-compose.yml',
      ['services:', '  frontend:', '    ports:', '      - "5173:5173"'].join('\n'),
    );
    write('package.json', JSON.stringify({ devDependencies: { vite: '^5.0.0' } }));
    const result = detectPortsNeed(tmpDir);
    // Both vite and the compose service trip signals. The compose port is a
    // real number from the project; the framework match contributes nothing
    // to guesses by design (see narrowing rationale in PortsHeuristic.ts).
    expect(result.signals.some((s) => s.includes('frontend'))).toBe(true);
    expect(result.signals.some((s) => s.includes('vite'))).toBe(true);
    expect(result.guesses).toEqual([
      { label: 'Frontend', envVar: 'FRONTEND_PORT', defaultPort: 5173 },
    ]);
  });
});

describe('detectPortsNeed — compose overrides', () => {
  it('merges base + override, with override winning per service', () => {
    // Base has the service but no published ports (production topology).
    write('docker-compose.yml', ['services:', '  api:', '    image: alpine'].join('\n'));
    // Override publishes the dev port — this is the canonical compose pattern.
    write(
      'docker-compose.override.yml',
      ['services:', '  api:', '    ports:', '      - "8100:8100"'].join('\n'),
    );
    const result = detectPortsNeed(tmpDir);
    expect(result.guesses).toEqual([{ label: 'Api', envVar: 'API_PORT', defaultPort: 8100 }]);
    expect(result.signals.some((s) => s.includes('docker-compose.override.yml'))).toBe(true);
  });

  it('takes override port when both files publish the same service', () => {
    write(
      'docker-compose.yml',
      ['services:', '  api:', '    ports:', '      - "8080:8080"'].join('\n'),
    );
    write(
      'docker-compose.override.yml',
      ['services:', '  api:', '    ports:', '      - "8100:8080"'].join('\n'),
    );
    const result = detectPortsNeed(tmpDir);
    // Override wins — matches how `docker compose up` resolves layered config.
    expect(result.guesses).toEqual([{ label: 'Api', envVar: 'API_PORT', defaultPort: 8100 }]);
  });

  it('handles dev/debug/local variants alongside the base file', () => {
    write('docker-compose.yml', ['services:', '  web:', '    image: nginx'].join('\n'));
    write(
      'docker-compose.dev.yml',
      ['services:', '  web:', '    ports:', '      - "3000:80"'].join('\n'),
    );
    expect(detectPortsNeed(tmpDir).guesses).toEqual([
      { label: 'Web', envVar: 'WEB_PORT', defaultPort: 3000 },
    ]);
  });
});

describe('detectPortsNeed — bespoke allocator detection', () => {
  it('flags dev.sh using cksum on the worktree name', () => {
    write(
      'dev.sh',
      [
        '#!/bin/bash',
        'WORKTREE_NAME=$(basename "$PWD")',
        'OFFSET=$(echo "$WORKTREE_NAME" | cksum | awk \'{print $1}\')',
        'export FRONTEND_PORT=$((5173 + OFFSET % 500 * 100))',
      ].join('\n'),
    );
    const result = detectPortsNeed(tmpDir);
    expect(result.signals.some((s) => s.includes('bespoke port allocator'))).toBe(true);
  });

  it('flags scripts/dev.sh in a nested location', () => {
    write(
      'scripts/dev.sh',
      ['#!/bin/sh', 'HASH=$(sha1sum <<< "$(basename "$PWD")")', 'export PORT_OFFSET=$HASH'].join(
        '\n',
      ),
    );
    const result = detectPortsNeed(tmpDir);
    expect(result.signals.some((s) => s.includes('bespoke port allocator'))).toBe(true);
  });

  it('does not flag innocuous scripts', () => {
    write('dev.sh', '#!/bin/bash\nnpm install && npm run dev\n');
    const result = detectPortsNeed(tmpDir);
    expect(result.signals.every((s) => !s.includes('bespoke port allocator'))).toBe(true);
  });
});
