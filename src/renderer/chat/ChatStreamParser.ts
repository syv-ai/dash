import type { ChatMessage, ChatContentBlock, StreamJsonEvent } from '../../shared/types';

/**
 * Parses Claude CLI `--output-format stream-json` JSONL output into ChatMessage objects.
 *
 * The stream produces newline-delimited JSON events. Each event has a `type` field:
 * - system: init/error events
 * - assistant: assistant message with content blocks
 * - user: echoed user input
 * - result: turn completion with cost/duration
 */
export class ChatStreamParser {
  private buffer = '';
  private messages: ChatMessage[] = [];
  private messageCounter = 0;
  private listeners: Set<() => void> = new Set();
  private _sessionId: string | null = null;
  private _isWaiting = false;
  private _waitingListeners: Set<(waiting: boolean) => void> = new Set();

  get sessionId(): string | null {
    return this._sessionId;
  }

  get isWaiting(): boolean {
    return this._isWaiting;
  }

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  /** Subscribe to message list changes. Returns unsubscribe function. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Subscribe to waiting state changes. */
  onWaitingChange(fn: (waiting: boolean) => void): () => void {
    this._waitingListeners.add(fn);
    return () => this._waitingListeners.delete(fn);
  }

  /** Feed raw PTY data (may contain partial lines). */
  feed(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    // Keep the last (possibly incomplete) line in the buffer
    this.buffer = lines.pop() || '';

    let changed = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed) as StreamJsonEvent;
        if (this.processEvent(event)) {
          changed = true;
        }
      } catch {
        // Not valid JSON — could be raw CLI output (banners, prompts).
        // Ignore gracefully.
      }
    }

    if (changed) {
      this.notify();
    }
  }

  /** Reset parser state. */
  reset(): void {
    this.buffer = '';
    this.messages = [];
    this.messageCounter = 0;
    this._sessionId = null;
    this._isWaiting = false;
    this.notify();
  }

  private processEvent(event: StreamJsonEvent): boolean {
    switch (event.type) {
      case 'system': {
        if (event.subtype === 'init' && event.session_id) {
          this._sessionId = event.session_id;
        }
        if (event.subtype === 'error' && event.message) {
          this.messages.push({
            id: `sys-${this.messageCounter++}`,
            role: 'system',
            content: [{ type: 'text', text: event.message }],
            timestamp: Date.now(),
          });
          return true;
        }
        return false;
      }

      case 'assistant': {
        this.setWaiting(false);
        const msg = event.message;
        this.messages.push({
          id: msg.id || `asst-${this.messageCounter++}`,
          role: 'assistant',
          content: msg.content as ChatContentBlock[],
          timestamp: Date.now(),
          model: msg.model,
        });
        return true;
      }

      case 'user': {
        this.setWaiting(false);
        const content: ChatContentBlock[] = event.message.content || [];
        this.messages.push({
          id: `user-${this.messageCounter++}`,
          role: 'user',
          content,
          timestamp: Date.now(),
        });
        return true;
      }

      case 'result': {
        this.setWaiting(true);
        // Attach cost to the last assistant message if available
        if (event.cost_usd && this.messages.length > 0) {
          const last = this.messages[this.messages.length - 1];
          if (last.role === 'assistant') {
            last.costUsd = event.cost_usd;
          }
        }
        return true;
      }

      default:
        return false;
    }
  }

  private setWaiting(waiting: boolean): void {
    if (this._isWaiting !== waiting) {
      this._isWaiting = waiting;
      for (const fn of this._waitingListeners) {
        fn(waiting);
      }
    }
  }

  private notify(): void {
    for (const fn of this.listeners) {
      fn();
    }
  }
}
