import React from 'react';
import { useAdoConnection } from './useAdoConnection';
import { AdoFormFields, AdoTestResult } from './AdoFormFields';
import { Button } from '../../ui/Button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '../../ui/Dialog';
import { useModalClose } from '../../ui/Modal';

interface AdoSetupModalProps {
  projectId: string;
  organizationUrl: string;
  project: string;
  onClose: () => void;
}

export function AdoSetupModal(props: AdoSetupModalProps) {
  return (
    <Dialog size="md" onClose={props.onClose}>
      <AdoSetupBody
        projectId={props.projectId}
        organizationUrl={props.organizationUrl}
        project={props.project}
        onClose={props.onClose}
      />
    </Dialog>
  );
}

interface AdoSetupBodyProps {
  projectId: string;
  organizationUrl: string;
  project: string;
  /** Propagated through to useAdoConnection.onSaved — the save callback closes the
   *  modal by calling the parent's onClose directly (skipping the fade-out animation),
   *  which is fine here because the parent immediately unmounts on success. */
  onClose: () => void;
}

function AdoSetupBody({ projectId, organizationUrl, project, onClose }: AdoSetupBodyProps) {
  const close = useModalClose();
  const conn = useAdoConnection({
    projectId,
    initialOrgUrl: organizationUrl,
    initialProject: project,
    onSaved: onClose,
  });

  return (
    <>
      <DialogHeader
        title="Connect Azure DevOps"
        description="This project's remote is on Azure DevOps. Add a personal access token to link work items to tasks."
      />
      <DialogBody>
        <AdoFormFields state={conn} autoFocusPat />
        <AdoTestResult result={conn.testResult} />
      </DialogBody>
      <DialogFooter
        start={
          <Button
            variant="secondary"
            disabled={!conn.canSubmit || conn.testing}
            onClick={() => void conn.handleTest()}
          >
            {conn.testing ? 'Testing…' : 'Test connection'}
          </Button>
        }
      >
        <Button variant="ghost" onClick={close}>
          Skip
        </Button>
        <Button disabled={!conn.canSubmit || conn.saving} onClick={() => void conn.handleSave()}>
          {conn.saving ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </>
  );
}
