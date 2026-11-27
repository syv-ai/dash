import { useState } from 'react';
import { Bot, ChevronUp } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/Popover';
import { NotesTray } from '../../review/NotesTray';

interface Props {
  taskId: string;
  /** The task's notes still to send, across every view. */
  unsent: number;
  /** Jump to a note — switches to its view (scope) + file as needed. */
  onNavigate: (scope: string, filePath: string, commentId: string) => void;
}

/** Below the code outside a PR view: "n to send", opening the task's Notes
 *  tray (the Review view shows the same tray). */
export function CommentsMenu({ taskId, unsent, onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="secondary" className="group/trigger">
          <Bot size={14} strokeWidth={1.8} />
          <span className="tabular-nums">{unsent} to send</span>
          <ChevronUp
            size={14}
            strokeWidth={1.8}
            className="transition-transform duration-calm ease-settle group-aria-expanded/trigger:rotate-180"
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="scrollbar-thin-hover max-h-130 w-115 overflow-y-auto"
      >
        <div className="py-2">
          <NotesTray
            taskId={taskId}
            onNavigate={(scope, path, id) => {
              setOpen(false);
              onNavigate(scope, path, id);
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}
