import React from 'react';
import type { GraphCommit } from '../../../shared/types';
import { getLaneColor } from './graphColors';
import {
  LANE_WIDTH,
  ROW_HEIGHT,
  NODE_RADIUS,
  LINE_WIDTH,
  GRAPH_PADDING_LEFT,
} from './graphLayout';

interface GraphSvgProps {
  commits: GraphCommit[];
  maxLanes: number;
  selectedRow: number | null;
}

export function GraphSvg({ commits, maxLanes, selectedRow }: GraphSvgProps) {
  const width = GRAPH_PADDING_LEFT + maxLanes * LANE_WIDTH + LANE_WIDTH;
  const height = commits.length * ROW_HEIGHT;

  function cx(column: number): number {
    return GRAPH_PADDING_LEFT + column * LANE_WIDTH + LANE_WIDTH / 2;
  }

  function cy(row: number): number {
    return row * ROW_HEIGHT + ROW_HEIGHT / 2;
  }

  return (
    <svg
      width={width}
      height={height}
      className="flex-shrink-0"
      style={{ minWidth: width }}
    >
      {/* Connection lines */}
      {commits.map((gc, row) =>
        gc.connections.map((conn, ci) => {
          const x1 = cx(conn.fromColumn);
          const y1 = cy(conn.fromRow);
          const x2 = cx(conn.toColumn);
          const y2 = cy(conn.toRow);
          const color = getLaneColor(conn.color);

          if (conn.fromColumn === conn.toColumn) {
            // Straight vertical line
            return (
              <line
                key={`${row}-${ci}`}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={color}
                strokeWidth={LINE_WIDTH}
                strokeOpacity={0.6}
              />
            );
          }

          // Curved line for merge/branch
          const midY = (y1 + y2) / 2;
          const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
          return (
            <path
              key={`${row}-${ci}`}
              d={d}
              fill="none"
              stroke={color}
              strokeWidth={LINE_WIDTH}
              strokeOpacity={0.6}
            />
          );
        }),
      )}

      {/* Commit dots */}
      {commits.map((gc, row) => {
        const x = cx(gc.lane);
        const y = cy(row);
        const color = getLaneColor(gc.laneColor);
        const isSelected = selectedRow === row;
        const isMerge = gc.commit.parents.length > 1;

        return (
          <g key={gc.commit.hash}>
            {/* Background ring for contrast */}
            <circle
              cx={x}
              cy={y}
              r={NODE_RADIUS + 1.5}
              fill="hsl(var(--background))"
            />
            {/* Commit dot */}
            <circle
              cx={x}
              cy={y}
              r={isMerge ? NODE_RADIUS + 1 : NODE_RADIUS}
              fill={isSelected ? color : isMerge ? 'hsl(var(--background))' : color}
              stroke={color}
              strokeWidth={isMerge ? LINE_WIDTH : isSelected ? 2.5 : 0}
            />
          </g>
        );
      })}
    </svg>
  );
}
