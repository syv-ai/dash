import { useEffect, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { Modal, useModalClose } from '../../ui/Modal';

interface Props {
  initialText: string;
  count: number;
  onClose: () => void;
  onSend: (editedText: string) => void;
}

export function EditCommentsModal({ initialText, count, onClose, onSend }: Props) {
  return (
    <Modal
      onClose={onClose}
      size="w-[760px]"
      cardStyle={{ background: 'hsl(var(--surface-2) / 0.55)' }}
    >
      <EditCommentsBody initialText={initialText} count={count} onSend={onSend} />
    </Modal>
  );
}

function EditCommentsBody({
  initialText,
  count,
  onSend,
}: {
  initialText: string;
  count: number;
  onSend: (editedText: string) => void;
}) {
  const close = useModalClose();
  const [text, setText] = useState(initialText);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus + place cursor at the end so the user can edit immediately without
  // clobbering the assembled prompt.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const canSend = text.trim().length > 0;

  function handleSend() {
    if (!canSend) return;
    onSend(text);
  }

  return (
    <>
      <div className="flex items-center justify-between px-5 h-12 border-b border-border/40">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-[14px] font-semibold text-foreground">Edit before sending</h2>
          <span className="text-[11.5px] text-muted-foreground/65">
            based on <span className="font-medium text-foreground/80 tabular-nums">{count}</span>{' '}
            {count === 1 ? 'comment' : 'comments'}
          </span>
        </div>
        <button
          onClick={close}
          className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground/50 hover:text-foreground transition-all duration-150"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>

      <div className="p-5 flex flex-col gap-3">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') e.stopPropagation();
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSend();
            }
          }}
          spellCheck={false}
          className="min-h-[520px] max-h-[70vh] w-full text-[12px] leading-relaxed font-mono bg-foreground/4 rounded-md px-3 py-2 resize-y placeholder:text-muted-foreground/40 focus:outline-hidden"
        />

        <div className="flex items-center justify-between gap-3">
          <span className="text-[10.5px] text-muted-foreground/55">
            <kbd className="font-mono px-1 py-0.5 rounded bg-foreground/6 border border-white/6">
              ⌘
            </kbd>
            <span className="mx-0.5">+</span>
            <kbd className="font-mono px-1 py-0.5 rounded bg-foreground/6 border border-white/6">
              ↵
            </kbd>
            <span className="ml-1.5">to send</span>
          </span>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={close}
              className="px-4 py-2 rounded-full text-[13px] text-muted-foreground/70 hover:text-foreground hover:bg-accent/60 transition-all duration-150"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-medium bg-primary text-primary-foreground hover:brightness-110 transition-all duration-150 disabled:opacity-40 disabled:pointer-events-none"
            >
              <Send size={13} strokeWidth={2} />
              Send
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
