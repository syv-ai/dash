import type { ConfirmOptions } from '../components/ui/ConfirmHost';

/** What a protected task is, said the same way wherever a person meets it. */
export const PROTECTED_HINT =
  "Agents can't archive or delete this task through dashctl; you still can, after a confirm.";

/** The confirm a person answers before archiving a protected task. */
export function protectedArchiveConfirm(name: string): ConfirmOptions {
  return {
    title: `Archive ${name}?`,
    message: `${name} is protected: agents can't archive or delete it. Archiving puts its session to sleep and takes it off the list; restoring brings it back.`,
    confirmLabel: 'Archive',
  };
}
