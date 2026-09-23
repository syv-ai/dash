import { useAddons } from '../../stores/addonsStore';
import { useSettings } from '../../stores/settingsStore';
import { Switch } from '../ui/Switch';
import { Segmented } from '../ui/Segmented';
import { AddOnAccordion } from './AddOnAccordion';
import { AddonBlocks, AddonSurfaceError } from './AddonBlocks';
import type { AddonListItem } from '@shared/addons';

/**
 * Settings → Add-ons: one accordion per add-on with its on/off switch, the
 * drawer's sidebar (only for add-ons that have a drawer), and whatever the
 * add-on's own settings surface returns.
 */
export function AddonSettingsSection() {
  const list = useAddons((s) => s.list);
  return (
    <>
      {list.map((item) => (
        <AddonSettings key={item.id} item={item} />
      ))}
    </>
  );
}

function statusOf(item: AddonListItem): {
  status: 'active' | 'inactive' | 'error';
  label: string;
} {
  if (item.status === 'failed') return { status: 'error', label: 'Failed' };
  if (item.status === 'active') return { status: 'active', label: 'On' };
  return { status: 'inactive', label: 'Off' };
}

function AddonSettings({ item }: { item: AddonListItem }) {
  const surfaces = useAddons((s) => s.settingsSurfaces.find((x) => x.addonId === item.id));
  const setEnabled = useAddons((s) => s.setEnabled);
  const action = useAddons((s) => s.action);
  const side = useSettings((s) => s.addonDrawerSide[item.id] ?? item.drawerSide);
  const setSides = useSettings((s) => s.setAddonDrawerSide);
  const { status, label } = statusOf(item);

  return (
    <AddOnAccordion
      title={item.name}
      subtitle={item.description}
      status={status}
      statusLabel={label}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <span className="flex-1 text-[12.5px] text-foreground">Enabled</span>
          <Switch
            enabled={item.enabled}
            onToggle={(v) => {
              void setEnabled(item.id, v);
            }}
            aria-label={`Enable ${item.name}`}
          />
        </div>
        {item.error && <AddonSurfaceError message={item.error} />}
        {item.hasDrawer && (
          <div className="flex items-center gap-4">
            <span className="flex-1 text-[12.5px] text-foreground">Drawer</span>
            <Segmented
              size="sm"
              fullWidth={false}
              value={side}
              options={[
                { value: 'left', label: 'Left sidebar' },
                { value: 'right', label: 'Right sidebar' },
              ]}
              onChange={(v) => {
                const current = useSettings.getState().addonDrawerSide;
                setSides({ ...current, [item.id]: v });
              }}
            />
          </div>
        )}
        {surfaces?.settingsError && <AddonSurfaceError message={surfaces.settingsError} />}
        {surfaces?.settings && surfaces.settings.length > 0 && (
          <AddonBlocks
            blocks={surfaces.settings}
            onAction={(actionId) => action(item.id, { surface: 'settings' }, actionId)}
          />
        )}
      </div>
    </AddOnAccordion>
  );
}
