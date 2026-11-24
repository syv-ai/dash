import * as React from 'react';
import {
  Archive,
  Copy,
  FileText,
  Folder,
  Inbox,
  MoreHorizontal,
  Moon,
  Pencil,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../components/ui/Command';
import { ConfirmModal } from '../components/ui/ConfirmModal';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '../components/ui/ContextMenu';
import { CountBadge } from '../components/ui/CountBadge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '../components/ui/DropdownMenu';
import { EmptyState } from '../components/ui/EmptyState';
import { DetailItem, DetailList, DetailSection } from '../components/ui/DetailList';
import { LineStats } from '../components/ui/LineStats';
import { IconButton } from '../components/ui/IconButton';
import { Input } from '../components/ui/Input';
import { Kbd } from '../components/ui/Kbd';
import { ListRow } from '../components/ui/ListRow';
import { MainRepoBadge } from '../components/ui/MainRepoBadge';
import { Meter, usageTone } from '../components/ui/Meter';
import { PanelHeader } from '../components/ui/PanelHeader';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/Popover';
import { PrBadge } from '../components/ui/PrBadge';
import { Segmented } from '../components/ui/Segmented';
import { Select } from '../components/ui/Select';
import { SettingsModalShell } from '../components/ui/SettingsModalShell';
import { Slider } from '../components/ui/Slider';
import { StatusDot, type AgentState } from '../components/ui/StatusDot';
import { Switch } from '../components/ui/Switch';
import { SwitchField } from '../components/ui/SwitchField';
import { PillTab } from '../components/ui/PillTab';
import { Textarea } from '../components/ui/Textarea';
import { Toaster } from '../components/ui/Toast';
import { TokenBadge } from '../components/ui/TokenBadge';
import { Tooltip } from '../components/ui/Tooltip';
import type { PullRequestInfo } from '../../shared/types';

type Theme = 'dark' | 'light';

const STATES: AgentState[] = ['needs', 'fail', 'work', 'done', 'idle'];

const PR_PASSING: PullRequestInfo = {
  number: 412,
  title: 'Primitives',
  url: '#',
  state: 'open',
  provider: 'github',
  ci: 'passing',
};
const PR_FAILING: PullRequestInfo = { ...PR_PASSING, number: 398, title: 'Shell', ci: 'failing' };
const PR_MERGED: PullRequestInfo = { ...PR_PASSING, number: 377, title: 'Theme', state: 'merged' };
const PRS = [PR_PASSING, PR_FAILING, PR_MERGED];

const noop = () => {};

function initialTheme(): Theme {
  return new URLSearchParams(window.location.search).get('theme') === 'light' ? 'light' : 'dark';
}

/**
 * Dev-only page (`?gallery`, optional `&theme=light`) showing every primitive
 * in `components/ui/` and its states, for review in both themes. Menus,
 * popovers, the tooltip and the dialogs are pinned open; flip "Pin open" off
 * to use them normally.
 */
export function Gallery() {
  const [theme, setTheme] = React.useState<Theme>(initialTheme);
  const [pinned, setPinned] = React.useState(true);

  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  React.useEffect(() => {
    toast('Task finished', {
      description: 'feat/primitives is ready for review.',
      action: { label: 'Open', onClick: noop },
      duration: Infinity,
      id: 'gallery',
    });
  }, []);

  return (
    <div className="h-screen overflow-y-auto bg-ground text-ink">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 p-6">
        <header className="flex items-center gap-4">
          <h1 className="type-title flex-1">Primitives</h1>
          <span className="text-sm text-ink-2">Pin open</span>
          <Switch checked={pinned} onCheckedChange={setPinned} aria-label="Pin overlays open" />
          <Segmented<Theme>
            value={theme}
            onChange={setTheme}
            fullWidth={false}
            size="sm"
            aria-label="Theme"
            options={[
              { value: 'dark', label: 'Dark', icon: <Moon size={14} strokeWidth={1.8} /> },
              { value: 'light', label: 'Light', icon: <Sun size={14} strokeWidth={1.8} /> },
            ]}
          />
        </header>

        <div className="grid grid-cols-3 gap-4">
          <Buttons pinned={pinned} />
          <Fields />
          <Badges />
          <Meters />
          <Rows />
          <PillTabs />
          <Menus pinned={pinned} />
          <TypeRoles />
        </div>

        {pinned && <Dialogs />}
      </div>
      <Toaster theme={theme} />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-well p-4">
      <h2 className="type-heading">{title}</h2>
      {children}
    </section>
  );
}

/** The type roles (D38), each named in its own style. */
function TypeRoles() {
  return (
    <Section title="Type roles">
      <div className="grid gap-2">
        <p className="type-title">type-title · Delete task</p>
        <p className="type-heading">type-heading · Session</p>
        <p className="type-subheading">type-subheading · Staged</p>
        <p className="type-label">type-label · Last active</p>
        <p className="type-body">type-body · Fix the flaky test in the runner.</p>
        <p className="type-caption">type-caption · 4 min ago</p>
      </div>
    </Section>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function Buttons({ pinned }: { pinned: boolean }) {
  return (
    <Section title="Button · IconButton · Tooltip · Kbd">
      <Line>
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Delete</Button>
      </Line>
      <Line>
        <Button size="sm">Commit</Button>
        <Button size="sm" variant="secondary">
          <Plus size={14} strokeWidth={1.8} />
          New task
        </Button>
        <Button size="sm" variant="ghost">
          Cancel
        </Button>
        <Button size="sm" disabled>
          Disabled
        </Button>
      </Line>
      <Line>
        <IconButton title="Settings">
          <Settings size={14} strokeWidth={1.8} />
        </IconButton>
        <IconButton title="Copy" size="sm">
          <Copy size={14} strokeWidth={1.8} />
        </IconButton>
        <IconButton title="Delete" variant="destructive">
          <Trash2 size={14} strokeWidth={1.8} />
        </IconButton>
        <IconButton title="Unavailable while running" disabled>
          <Archive size={14} strokeWidth={1.8} />
        </IconButton>
        <IconButton title="Projects" pressed>
          <Folder size={14} strokeWidth={1.8} />
        </IconButton>
        <Button size="icon" variant="secondary" aria-label="Search">
          <Search size={14} strokeWidth={1.8} />
        </Button>
        <Tooltip content="Open in editor" side="right" open={pinned || undefined}>
          <Button size="sm" variant="ghost">
            Tooltip
          </Button>
        </Tooltip>
      </Line>
      <Line>
        <span className="text-sm text-ink-2">Search</span>
        <Kbd>⌘K</Kbd>
        <Kbd>⇧</Kbd>
        <Kbd>Esc</Kbd>
      </Line>
    </Section>
  );
}

function Fields() {
  const [text, setText] = React.useState('feat/primitives');
  const [model, setModel] = React.useState<'opus' | 'sonnet' | 'haiku'>('opus');
  const [on, setOn] = React.useState(true);
  const [level, setLevel] = React.useState(40);
  const [view, setView] = React.useState<'changed' | 'all' | 'staged'>('changed');
  return (
    <Section title="Input · Textarea · Select · Switch · Slider · Segmented">
      <Input value={text} onChange={(e) => setText(e.target.value)} aria-label="Branch" />
      <Line>
        <Input placeholder="Placeholder" className="w-40" aria-label="Placeholder" />
        <Input placeholder="Disabled" disabled className="w-40" aria-label="Disabled" />
      </Line>
      <Textarea placeholder="Describe the task…" rows={2} aria-label="Prompt" />
      <Select
        value={model}
        onValueChange={setModel}
        aria-label="Model"
        options={[
          { value: 'opus', label: 'Opus' },
          { value: 'sonnet', label: 'Sonnet' },
          { value: 'haiku', label: 'Haiku' },
        ]}
      />
      <Line>
        <Switch checked={on} onCheckedChange={setOn} aria-label="On" />
        <Switch checked={false} onCheckedChange={noop} aria-label="Off" />
        <Switch checked size="sm" onCheckedChange={noop} aria-label="Small" />
        <Switch checked disabled onCheckedChange={noop} aria-label="Disabled" />
        <div className="flex-1">
          <Slider value={level} onValueChange={setLevel} min={0} max={100} aria-label="Level" />
        </div>
      </Line>
      <SwitchField
        label="Let the agent reach Dash"
        hint="Exposes dashctl inside the task."
        checked={on}
        onCheckedChange={setOn}
      />
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'changed', label: 'Changed', count: 4 },
          { value: 'all', label: 'Files' },
          { value: 'staged', label: 'Staged', count: 0 },
        ]}
      />
      <Segmented
        value={view}
        onChange={setView}
        size="sm"
        fullWidth={false}
        options={[
          { value: 'changed', label: 'Changed' },
          { value: 'all', label: 'All' },
          { value: 'staged', label: 'Staged' },
        ]}
      />
    </Section>
  );
}

function Badges() {
  return (
    <Section title="Badge · StatusDot">
      <Line>
        <Badge>neutral</Badge>
        <Badge tone="needs">needs you</Badge>
        <Badge tone="fail">failed</Badge>
        <Badge tone="work">working</Badge>
        <Badge tone="done">done</Badge>
        <Badge tone="bare">bare</Badge>
      </Line>
      <Line>
        <Badge size="sm">sm</Badge>
        <CountBadge count={3} />
        <CountBadge count={128} />
        <TokenBadge totalTokens={184_000} totalCostUsd={1.42} />
        <TokenBadge totalTokens={9_200} totalCostUsd={0.08} size="sm" />
        <MainRepoBadge task={{ id: 'gallery', branch: 'main' }} />
        <LineStats add={128} del={14} />
        <span className="text-xs">
          <LineStats add={3} del={0} />
        </span>
      </Line>
      <Line>
        <PrBadge prs={[PR_PASSING]} allPrs={PRS} />
        <PrBadge prs={[PR_FAILING]} allPrs={PRS} size="sm" taskId="gallery" />
        <PrBadge prs={[]} allPrs={[PR_MERGED]} />
        <PrBadge prs={[PR_PASSING]} variant="icon" />
      </Line>
      <Line>
        {STATES.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5 text-sm text-ink-2">
            <StatusDot state={s} label={s} />
            {s}
          </span>
        ))}
      </Line>
    </Section>
  );
}

function Meters() {
  return (
    <Section title="Meter">
      {[0, 50, 90].map((v) => (
        <Meter key={v} label={`Usage ${v}%`} value={v} tone={usageTone(v)} detail="resets 4h" />
      ))}
      <Meter label="Session context" value={62} />
      <Meter value={35} role="progressbar" aria-label="Downloading" />
      <Meter value={70} tone="work" size="sm" aria-label="Context" />
    </Section>
  );
}

function Rows() {
  const [current, setCurrent] = React.useState('primitives');
  const tasks: Array<{ id: string; state: AgentState; time: string }> = [
    { id: 'needs-review', state: 'needs', time: '2m' },
    { id: 'flaky-test', state: 'fail', time: '9m' },
    { id: 'primitives', state: 'work', time: 'now' },
    { id: 'theme-tokens', state: 'done', time: '1h' },
    { id: 'old-spike', state: 'idle', time: '3d' },
  ];
  return (
    <Section title="PanelHeader · ListRow · DetailList · EmptyState">
      <div className="flex flex-col">
        <PanelHeader
          title="Tasks"
          actions={
            <>
              <IconButton title="Search" size="sm">
                <Search size={14} strokeWidth={1.8} />
              </IconButton>
              <IconButton title="New task" size="sm">
                <Plus size={14} strokeWidth={1.8} />
              </IconButton>
            </>
          }
        />
        {tasks.map((t) => (
          <ListRow
            key={t.id}
            selected={t.id === current}
            onClick={() => setCurrent(t.id)}
            dimmed={t.state === 'idle'}
            leading={<StatusDot state={t.state} />}
            description={t.state === 'needs' ? 'Approve Bash: pnpm test' : undefined}
            trailing={t.time}
          >
            {t.id}
          </ListRow>
        ))}
        <ListRow size="sm" leading={<Folder size={14} strokeWidth={1.8} />} trailing="3">
          src/renderer
        </ListRow>
        <ListRow size="sm" leading={<FileText size={14} strokeWidth={1.8} />} trailing="M">
          Button.tsx
        </ListRow>
      </div>
      <div className="w-80">
        <DetailSection
          title="Task"
          action={
            <Button size="sm" variant="ghost">
              Edit
            </Button>
          }
        >
          <DetailList>
            <DetailItem label="Name">Fix the header</DetailItem>
            <DetailItem label="Branch" copy="fix/header">
              fix/header
            </DetailItem>
            <DetailItem label="Tokens" title="184,000 tokens">
              184.0k
            </DetailItem>
          </DetailList>
        </DetailSection>
      </div>
      <EmptyState
        icon={<Inbox size={14} strokeWidth={1.8} />}
        title="No archived tasks"
        description="Archived tasks show here"
        action={
          <Button size="sm" variant="secondary">
            Show all
          </Button>
        }
      />
    </Section>
  );
}

function PillTabs() {
  const [tabs, setTabs] = React.useState(['App.tsx', 'index.css', 'README.md']);
  const [active, setActive] = React.useState('App.tsx');
  return (
    <Section title="PillTab">
      <Line>
        {tabs.map((t) => (
          <PillTab
            key={t}
            active={t === active}
            onSelect={() => setActive(t)}
            onClose={() => setTabs((all) => all.filter((x) => x !== t))}
            closeLabel={`Close ${t}`}
            indicator={
              <span className={`size-1.5 rounded-full ${t === 'index.css' ? 'bg-ink-2' : ''}`} />
            }
          >
            {t}
          </PillTab>
        ))}
      </Line>
      <Line>
        <PillTab active muted onSelect={() => {}}>
          unfocused group
        </PillTab>
        <PillTab tone="service" active onSelect={() => {}}>
          dev
        </PillTab>
        <PillTab tone="service" onSelect={() => {}}>
          api
        </PillTab>
        <PillTab tone="primary" onSelect={() => {}}>
          Ports setup
        </PillTab>
      </Line>
    </Section>
  );
}

function Menus({ pinned }: { pinned: boolean }) {
  return (
    <Section title="DropdownMenu · Popover · ContextMenu · Command">
      <DropdownMenu open={pinned || undefined} modal={false}>
        <DropdownMenuTrigger asChild>
          <IconButton title="More actions">
            <MoreHorizontal size={14} strokeWidth={1.8} />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="bottom">
          <DropdownMenuLabel>Task</DropdownMenuLabel>
          <DropdownMenuItem>
            <Pencil size={14} strokeWidth={1.8} />
            Rename
            <DropdownMenuShortcut>⌘R</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem>
            <Copy size={14} strokeWidth={1.8} />
            Copy branch
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <Archive size={14} strokeWidth={1.8} />
            Archive
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>
            <Trash2 size={14} strokeWidth={1.8} />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <div className="h-44" />
      <Line>
        <Popover open={pinned || undefined} modal={false}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="secondary">
              Popover
            </Button>
          </PopoverTrigger>
          <PopoverContent side="right" align="start" className="w-56">
            <p className="p-3 text-sm text-ink-2">A popover holds a small form or details.</p>
          </PopoverContent>
        </Popover>
      </Line>
      <div className="h-8" />
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="rounded-lg bg-hover p-3 text-center text-sm text-ink-3">
            Right-click for a context menu
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem>Open</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem>Delete</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <div className="rounded-lg bg-raised shadow-raised">
        <Command>
          <CommandInput placeholder="Search tasks and actions…" />
          <CommandList>
            <CommandEmpty>Nothing found.</CommandEmpty>
            <CommandGroup heading="Tasks">
              <CommandItem>
                <StatusDot state="needs" />
                needs-review
              </CommandItem>
              <CommandItem>
                <StatusDot state="work" />
                primitives
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading="Actions">
              <CommandItem>
                <Plus size={14} strokeWidth={1.8} />
                New task
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </div>
    </Section>
  );
}

/** Each dialog sits in a transformed box, which becomes the containing block
 *  for the Modal's fixed backdrop, so they render side by side in the page. */
function Dialogs() {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="relative h-72 transform-gpu overflow-hidden rounded-xl bg-well">
        <ConfirmModal
          message="Delete this task and its worktree? Uncommitted changes are lost."
          confirmLabel="Delete"
          onConfirm={noop}
          onCancel={noop}
        />
      </div>
      <div className="relative h-72 transform-gpu overflow-hidden rounded-xl bg-well">
        <SettingsModalShell title="Task settings" onClose={noop} size="w-96">
          <SwitchField label="Let the agent reach Dash" checked onCheckedChange={noop} />
          <Input defaultValue="feat/primitives" aria-label="Branch" />
        </SettingsModalShell>
      </div>
    </div>
  );
}
