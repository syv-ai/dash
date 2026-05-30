export type HookStatus = 'Passed' | 'Failed' | 'Skipped';

export type ParserEvent =
  | { type: 'hookResult'; name: string; status: HookStatus }
  | {
      type: 'hookMeta';
      key: 'id' | 'exit' | 'duration' | 'modified';
      value: string | number | true;
    }
  | { type: 'hookDiagnostic'; text: string }
  | { type: 'rawOutput'; text: string };

const HEADER = /^(.+?)\.{4,}(Passed|Failed|Skipped)\s*$/;
const META_ID = /^- hook id: (.+)$/;
const META_EXIT = /^- exit code: (\d+)$/;
const META_DURATION = /^- duration: ([\d.]+)s$/;
const META_MODIFIED = /^- files were modified by this hook$/;

interface ParserState {
  inHook: boolean;
}

export interface Parser {
  feed(line: string): ParserEvent[];
  flush(): ParserEvent[];
}

export function createParser(): Parser {
  const state: ParserState = { inHook: false };
  return {
    feed(line) {
      const evts: ParserEvent[] = [];
      const headerMatch = HEADER.exec(line);
      if (headerMatch) {
        state.inHook = true;
        evts.push({
          type: 'hookResult',
          name: headerMatch[1].trimEnd(),
          status: headerMatch[2] as HookStatus,
        });
        return evts;
      }
      if (state.inHook) {
        const idM = META_ID.exec(line);
        if (idM) {
          evts.push({ type: 'hookMeta', key: 'id', value: idM[1] });
          return evts;
        }
        const exitM = META_EXIT.exec(line);
        if (exitM) {
          evts.push({ type: 'hookMeta', key: 'exit', value: parseInt(exitM[1], 10) });
          return evts;
        }
        const durM = META_DURATION.exec(line);
        if (durM) {
          evts.push({ type: 'hookMeta', key: 'duration', value: parseFloat(durM[1]) });
          return evts;
        }
        if (META_MODIFIED.test(line)) {
          evts.push({ type: 'hookMeta', key: 'modified', value: true });
          return evts;
        }
        evts.push({ type: 'hookDiagnostic', text: line });
        return evts;
      }
      evts.push({ type: 'rawOutput', text: line });
      return evts;
    },
    flush() {
      return [];
    },
  };
}
