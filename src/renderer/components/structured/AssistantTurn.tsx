import React from 'react';
import type { AssistantTurnData } from '../../../shared/sessionTypes';
import { ToolCallCard } from './ToolCallCard';

interface AssistantTurnProps {
  turn: AssistantTurnData;
  taskPath: string;
}

export function AssistantTurn({ turn, taskPath }: AssistantTurnProps) {
  if (turn.toolExecutions.length === 0) return null;

  return (
    <>
      {turn.toolExecutions.map((exec, i) => {
        const prev = i > 0 ? turn.toolExecutions[i - 1] : null;
        const hideToolLabel = prev?.toolCall.name === exec.toolCall.name;
        return (
          <ToolCallCard
            key={exec.toolCall.id}
            exec={exec}
            taskPath={taskPath}
            hideToolLabel={hideToolLabel}
          />
        );
      })}
    </>
  );
}
