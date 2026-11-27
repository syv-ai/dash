import React, { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import type { AgentDefinition } from '../../../shared/slashCommands';
import { SettingRow } from '../ui/Field';
import { Select, type SelectOption } from '../ui/Select';

const NONE = '';

const HINT =
  "Run the session as one of your custom agents (claude --agent): its prompt replaces Claude Code's default one, and its tools and model apply. From .claude/agents in the project or your home, or an enabled plugin. Fixed once the task is made.";

/** The custom agents a session in `projectPath` can run as; [] until read or on error. */
export function useAgents(projectPath: string): AgentDefinition[] {
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  useEffect(() => {
    let live = true;
    void window.electronAPI.agentsList({ projectPath }).then((resp) => {
      if (live) setAgents(resp.success && resp.data ? resp.data : []);
    });
    return () => {
      live = false;
    };
  }, [projectPath]);
  return agents;
}

/**
 * New task's Agent: one settings row, None or a custom agent by name, the
 * chosen one's description under it. `null` is None (no `--agent`).
 */
export function AgentPicker({
  projectPath,
  value,
  onChange,
}: {
  projectPath: string;
  value: string | null;
  onChange: (agent: string | null) => void;
}) {
  const agents = useAgents(projectPath);
  const options: SelectOption<string>[] = [
    { value: NONE, label: 'None' },
    ...agents.map((a) => ({ value: a.name, label: a.name })),
  ];
  const chosen = agents.find((a) => a.name === value);
  return (
    <SettingRow
      label="Agent"
      hint={agents.length > 0 ? HINT : `${HINT} This project has none yet.`}
      note={chosen?.description || undefined}
      control={
        <div className="w-48">
          <Select<string>
            aria-label="Agent"
            value={value ?? NONE}
            onValueChange={(v) => onChange(v === NONE ? null : v)}
            options={options}
            renderOption={(opt) => (
              <span className="inline-flex min-w-0 items-center gap-2 align-middle">
                <Bot size={14} strokeWidth={1.8} className="shrink-0 text-icon" />
                <span className="truncate">{opt.label}</span>
              </span>
            )}
          />
        </div>
      }
    />
  );
}
