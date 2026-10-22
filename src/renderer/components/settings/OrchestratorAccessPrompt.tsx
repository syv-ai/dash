import React, { useEffect, useState } from 'react';
import { ConfirmModal } from '../ui/ConfirmModal';
import { useSettings } from '../../stores/settingsStore';

/** Asks, when `dashctl` from outside Dash finds orchestrator access off,
 *  whether to turn it on. Allow sets the same Settings switch; Deny (or
 *  closing) leaves it off. Main closes a prompt nobody answered in time. */
export function OrchestratorAccessPrompt() {
  const [requestId, setRequestId] = useState<string | null>(null);
  const setOrchestratorAccess = useSettings((s) => s.setOrchestratorAccess);

  useEffect(
    () =>
      // `?.`: a renderer hot-reloaded over an older preload has no such bridge yet.
      window.electronAPI.onOrchestratorAccessRequest?.(({ id, open }) =>
        setRequestId((current) => (open ? id : current === id ? null : current)),
      ),
    [],
  );

  if (requestId === null) return null;
  const answer = (allowed: boolean) => {
    if (allowed) setOrchestratorAccess(true);
    window.electronAPI.answerOrchestratorAccess({ id: requestId, allowed });
    setRequestId(null);
  };

  return (
    <ConfirmModal
      message="An agent outside Dash, such as Holi's vault agent, wants to control Dash: create and drive tasks, read what they show, and run their services. Allow turns on “Let other agents control Dash” in Settings → Claude, where you can turn it off again."
      confirmLabel="Allow"
      cancelLabel="Deny"
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
    />
  );
}
