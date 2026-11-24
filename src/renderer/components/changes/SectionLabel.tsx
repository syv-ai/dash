import type { ReactNode } from 'react';

/** A section title in the changes list ("Staged · 3"). */
export function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="type-subheading px-2.5 pt-2 pb-1">{children}</div>;
}
