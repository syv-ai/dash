import React from 'react';
import type { RateLimitInfo, RateLimits } from '../../../shared/types';
import type { LimitKey } from '../../lib/pace';
import { resetClock } from '../../../shared/rateLimits';
import { usageColor } from '../../lib/usageColor';
import { useRuntime } from '../../stores/runtimeStore';
import { useSettings } from '../../stores/settingsStore';
import { formatCost, formatResetTime, formatTokens } from '../../utils/format';
import { FormSection, SettingRow } from '../ui/Field';
import { Input } from '../ui/Input';
import { Meter } from '../ui/Meter';
import { SwitchField } from '../ui/SwitchField';
import { LIMIT_LABELS } from '../rightInspector/UsageSection';

const LIMIT_KEYS = Object.keys(LIMIT_LABELS) as LimitKey[];

/** A limit's meter; a window that isn't running (it reset, and no message
 *  has started the next) reads 0%, as in the task sidebar (R16). */
function LimitMeter({ label, info }: { label: string; info: RateLimitInfo | undefined }) {
  const pct = info?.usedPercentage ?? 0;
  const detail = info?.reached
    ? `reached · resets at ${info.resetsAt ? resetClock(info.resetsAt, Date.now()) : 'its reset'}`
    : info?.resetsAt
      ? `resets ${formatResetTime(info.resetsAt)}`
      : info
        ? undefined
        : 'starts with the next message';
  return <Meter label={label} value={pct} color={usageColor(pct)} detail={detail} />;
}

export function UsageTab({ latestRateLimits }: { latestRateLimits?: RateLimits }) {
  const globalTokenStats = useRuntime((s) => s.globalTokenStats);
  const thresholds = useSettings((s) => s.usageThresholds);
  const setThresholds = useSettings((s) => s.setUsageThresholds);
  const showRateLimits = useSettings((s) => s.showRateLimits);
  const setShowRateLimits = useSettings((s) => s.setShowRateLimits);
  const showPace = useSettings((s) => s.showPace);
  const setShowPace = useSettings((s) => s.setShowPace);
  const showUsageInline = useSettings((s) => s.showUsageInline);
  const setShowUsageInline = useSettings((s) => s.setShowUsageInline);
  const showTaskTokens = useSettings((s) => s.showTaskTokens);
  const setShowTaskTokens = useSettings((s) => s.setShowTaskTokens);
  const showTaskCost = useSettings((s) => s.showTaskCost);
  const setShowTaskCost = useSettings((s) => s.setShowTaskCost);
  const showProjectTokens = useSettings((s) => s.showProjectTokens);
  const setShowProjectTokens = useSettings((s) => s.setShowProjectTokens);

  return (
    <>
      <FormSection>
        <SettingRow
          label={`Tokens across ${globalTokenStats.taskCount} ${
            globalTokenStats.taskCount === 1 ? 'task' : 'tasks'
          }`}
          hint="Cost is worked out from the token counts."
          control={
            <span className="type-heading tabular-nums">
              {formatTokens(globalTokenStats.totalTokens)} ·{' '}
              {formatCost(globalTokenStats.totalCostUsd)}
            </span>
          }
        />
      </FormSection>

      <FormSection title="Rate limits">
        {latestRateLimits ? (
          <div className="grid gap-3">
            {LIMIT_KEYS.map((key) => (
              <LimitMeter key={key} label={LIMIT_LABELS[key]} info={latestRateLimits[key]} />
            ))}
          </div>
        ) : (
          <p className="type-caption py-1">Shown after the first reply from the API.</p>
        )}
      </FormSection>

      <FormSection title="Display">
        <SwitchField
          label="Show rate limits"
          hint="The 5-hour and weekly limits in the task sidebar's usage row."
          checked={showRateLimits}
          onCheckedChange={setShowRateLimits}
        />
        <SwitchField
          label="Show pace"
          hint="How fast those limits are being used, once there's enough data."
          checked={showPace}
          onCheckedChange={setShowPace}
          disabled={!showRateLimits}
        />
        <SwitchField
          label="Show context usage"
          hint="The session's context-window use, first in the usage row."
          checked={showUsageInline}
          onCheckedChange={setShowUsageInline}
        />
        <SwitchField
          label="Show task tokens"
          hint="The task's token count in its header."
          checked={showTaskTokens}
          onCheckedChange={setShowTaskTokens}
        />
        <SwitchField
          label="Show task cost"
          hint="The cost in dollars beside the token count."
          checked={showTaskCost}
          onCheckedChange={setShowTaskCost}
          disabled={!showTaskTokens}
        />
        <SwitchField
          label="Show project tokens on hover"
          hint="A project's token total when you hover its row in the sidebar."
          checked={showProjectTokens}
          onCheckedChange={setShowProjectTokens}
        />
      </FormSection>

      <FormSection
        title="Alerts"
        hint="Notify when usage passes a percentage. Leave blank for no alert."
      >
        <ThresholdRow
          label="Context window"
          value={thresholds.contextPercentage}
          placeholder="80"
          onChange={(v) => setThresholds({ ...thresholds, contextPercentage: v })}
        />
        <ThresholdRow
          label="5-hour limit"
          value={thresholds.fiveHourPercentage}
          onChange={(v) => setThresholds({ ...thresholds, fiveHourPercentage: v })}
        />
        <ThresholdRow
          label="Weekly limit"
          value={thresholds.sevenDayPercentage}
          onChange={(v) => setThresholds({ ...thresholds, sevenDayPercentage: v })}
        />
      </FormSection>
    </>
  );
}

function ThresholdRow({
  label,
  value,
  placeholder = 'Off',
  onChange,
}: {
  label: string;
  value: number | null;
  placeholder?: string;
  onChange: (v: number | null) => void;
}) {
  const id = React.useId();
  return (
    <SettingRow
      label={label}
      htmlFor={id}
      control={
        <span className="flex items-center gap-1.5">
          <Input
            id={id}
            type="number"
            min={0}
            max={100}
            step={5}
            value={value ?? ''}
            placeholder={placeholder}
            onChange={(e) => {
              const raw = e.target.value;
              const n = Number(raw);
              onChange(raw === '' || !Number.isFinite(n) || n < 0 ? null : Math.min(100, n));
            }}
            className="w-16 text-right"
          />
          <span className="type-caption">%</span>
        </span>
      }
    />
  );
}
