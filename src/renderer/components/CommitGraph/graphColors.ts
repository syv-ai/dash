// 8-color palette for branch lanes, using CSS custom properties
// Colors are chosen for contrast against both light and dark backgrounds
export const LANE_COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--git-added))',
  'hsl(210 80% 60%)',
  'hsl(330 70% 60%)',
  'hsl(45 85% 55%)',
  'hsl(180 60% 50%)',
  'hsl(270 60% 65%)',
  'hsl(15 80% 58%)',
];

export function getLaneColor(index: number): string {
  return LANE_COLORS[index % LANE_COLORS.length];
}
