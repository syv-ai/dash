import React from 'react';
import type { AssistantTurnData } from '../../../shared/sessionTypes';
import { ToolCallCard } from './ToolCallCard';

interface AssistantTurnProps {
  turn: AssistantTurnData;
}

export function AssistantTurn({ turn }: AssistantTurnProps) {
  if (turn.toolExecutions.length === 0) return null;

  return (
    <>
      {turn.toolExecutions.map((exec) => (
        <ToolCallCard key={exec.toolCall.id} exec={exec} />
      ))}
    </>
  );
}
