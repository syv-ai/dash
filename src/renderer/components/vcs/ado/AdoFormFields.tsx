import React from 'react';
import { Check, AlertCircle } from 'lucide-react';
import type { useAdoConnection, AdoTestOutcome } from './useAdoConnection';
import { Field } from '../../ui/Field';
import { Input } from '../../ui/Input';
import { Notice } from '../../ui/Notice';

type AdoConnectionState = ReturnType<typeof useAdoConnection>;

interface AdoFormFieldsProps {
  state: AdoConnectionState;
  autoFocusPat?: boolean;
}

export function AdoFormFields({ state, autoFocusPat }: AdoFormFieldsProps) {
  const { orgUrl, setOrgUrl, project, setProject, pat, setPat, setTestResult, isUrlValid } = state;

  return (
    <>
      <Field
        label="Organization URL"
        hint={
          orgUrl && !isUrlValid ? (
            <span className="text-state-fail">Starts with https://</span>
          ) : undefined
        }
      >
        <Input
          value={orgUrl}
          aria-invalid={!!orgUrl && !isUrlValid}
          onChange={(e) => {
            setOrgUrl(e.target.value);
            setTestResult(null);
          }}
          placeholder="https://dev.azure.com/myorg"
        />
      </Field>
      <Field label="Project">
        <Input
          value={project}
          onChange={(e) => {
            setProject(e.target.value);
            setTestResult(null);
          }}
          placeholder="MyProject"
        />
      </Field>
      <Field label="Personal access token">
        <Input
          type="password"
          value={pat}
          onChange={(e) => {
            setPat(e.target.value);
            setTestResult(null);
          }}
          placeholder="Paste a token"
          autoFocus={autoFocusPat}
        />
      </Field>
    </>
  );
}

/** The connection test's outcome: a neutral note (colour is for agent
 *  state), its icon saying which. */
export function AdoTestResult({ result }: { result: AdoTestOutcome | null }) {
  if (!result) return null;
  const ok = result === 'success';
  return (
    <Notice
      icon={
        ok ? <Check size={14} strokeWidth={1.8} /> : <AlertCircle size={14} strokeWidth={1.8} />
      }
    >
      <span className="break-words">{ok ? 'Connected.' : result.error}</span>
    </Notice>
  );
}
