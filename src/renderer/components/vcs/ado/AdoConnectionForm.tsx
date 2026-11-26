import React, { useState } from 'react';
import { useAdoConnection, useAdoConnectionLoader } from './useAdoConnection';
import { AdoFormFields, AdoTestResult } from './AdoFormFields';
import { Button } from '../../ui/Button';
import { SwitchField } from '../../ui/SwitchField';

interface AdoConnectionFormProps {
  projectId?: string;
}

export function AdoConnectionForm({ projectId }: AdoConnectionFormProps) {
  const [enabled, setEnabled] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [configured, setConfigured] = useState(false);

  const conn = useAdoConnection({
    projectId,
    onSaved: () => setConfigured(true),
  });

  useAdoConnectionLoader(conn, projectId, setEnabled, setConfigured);

  async function handleToggle() {
    if (enabled) {
      await window.electronAPI.adoRemoveConfig(projectId);
      conn.setOrgUrl('');
      conn.setProject('');
      conn.setPat('');
      conn.setTestResult(null);
      setConfigured(false);
      setExpanded(false);
      setEnabled(false);
    } else {
      setEnabled(true);
      setExpanded(true);
    }
  }

  return (
    <SwitchField
      label="Link work items"
      hint={configured ? 'Connected.' : 'Not set up. Turning it on asks for a token.'}
      checked={enabled}
      onCheckedChange={() => void handleToggle()}
    >
      {enabled && !expanded && (
        <div>
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Edit connection
          </Button>
        </div>
      )}
      {enabled && expanded && (
        <div className="grid gap-3">
          <AdoFormFields state={conn} />
          <AdoTestResult result={conn.testResult} />
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!conn.canSubmit || conn.testing}
              onClick={() => void conn.handleTest()}
            >
              {conn.testing ? 'Testing…' : 'Test connection'}
            </Button>
            <Button
              size="sm"
              disabled={!conn.canSubmit || conn.saving}
              onClick={() => void conn.handleSave()}
            >
              {conn.saving ? 'Saving…' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </SwitchField>
  );
}
