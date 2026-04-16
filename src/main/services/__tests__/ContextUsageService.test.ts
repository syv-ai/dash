import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron to avoid native module issues in tests
vi.mock('electron', () => ({
  default: {},
}));

import { contextUsageService, RawStatusLinePayload } from '../ContextUsageService';

describe('ContextUsageService', () => {
  beforeEach(() => {
    contextUsageService.stop();
  });

  describe('updateFromStatusLine', () => {
    it('ignores payloads without context_window', () => {
      contextUsageService.updateFromStatusLine('pty1', {} as RawStatusLinePayload);
      const all = contextUsageService.getAllStatusLine();
      expect(all['pty1']).toBeUndefined();
    });

    it('parses current_usage as a raw number', () => {
      contextUsageService.updateFromStatusLine('pty1', {
        context_window: {
          context_window_size: 200000,
          current_usage: 100000,
        },
      });
      const sl = contextUsageService.getAllStatusLine()['pty1'];
      expect(sl.contextUsage.used).toBe(100000);
      expect(sl.contextUsage.total).toBe(200000);
      expect(sl.contextUsage.percentage).toBeCloseTo(50, 0);
    });

    it('parses current_usage as an object with token counts', () => {
      contextUsageService.updateFromStatusLine('pty1', {
        context_window: {
          context_window_size: 200000,
          current_usage: {
            input_tokens: 50000,
            output_tokens: 30000,
            cache_creation_input_tokens: 20000,
          },
        },
      });
      const sl = contextUsageService.getAllStatusLine()['pty1'];
      expect(sl.contextUsage.used).toBe(100000);
      expect(sl.contextUsage.total).toBe(200000);
    });

    it('falls back to used_percentage when current_usage is missing', () => {
      contextUsageService.updateFromStatusLine('pty1', {
        context_window: {
          context_window_size: 200000,
          used_percentage: 75,
        },
      });
      const sl = contextUsageService.getAllStatusLine()['pty1'];
      expect(sl.contextUsage.used).toBe(150000);
      expect(sl.contextUsage.percentage).toBeCloseTo(75, 0);
    });

    it('clamps percentage to [0, 100]', () => {
      contextUsageService.updateFromStatusLine('pty1', {
        context_window: {
          context_window_size: 100,
          current_usage: 200, // 200% of total
        },
      });
      const sl = contextUsageService.getAllStatusLine()['pty1'];
      expect(sl.contextUsage.percentage).toBe(100);
    });

    it('handles zero total gracefully', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      contextUsageService.updateFromStatusLine('pty1', {
        context_window: {
          context_window_size: 0,
          current_usage: 50000,
        },
      });
      const sl = contextUsageService.getAllStatusLine()['pty1'];
      expect(sl.contextUsage.percentage).toBe(0);
      expect(spy).toHaveBeenCalledWith(
        '[ContextUsageService] context_window_size is 0 or missing for ptyId=',
        'pty1',
      );
      spy.mockRestore();
    });

    it('parses cost fields', () => {
      contextUsageService.updateFromStatusLine('pty1', {
        context_window: { context_window_size: 200000, current_usage: 100000 },
        cost: {
          total_cost_usd: 1.5,
          total_duration_ms: 60000,
          total_api_duration_ms: 45000,
          total_lines_added: 100,
          total_lines_removed: 50,
        },
      });
      const sl = contextUsageService.getAllStatusLine()['pty1'];
      expect(sl.cost).toEqual({
        totalCostUsd: 1.5,
        totalDurationMs: 60000,
        totalApiDurationMs: 45000,
        totalLinesAdded: 100,
        totalLinesRemoved: 50,
      });
    });

    it('parses rate limits', () => {
      contextUsageService.updateFromStatusLine('pty1', {
        context_window: { context_window_size: 200000, current_usage: 100000 },
        rate_limits: {
          five_hour: { used_percentage: 42, resets_at: 1700000000 },
          seven_day: { used_percentage: 15, resets_at: 1700100000 },
        },
      });
      const sl = contextUsageService.getAllStatusLine()['pty1'];
      expect(sl.rateLimits?.fiveHour).toEqual({ usedPercentage: 42, resetsAt: 1700000000 });
      expect(sl.rateLimits?.sevenDay).toEqual({ usedPercentage: 15, resetsAt: 1700100000 });
    });

    it('parses model as a string', () => {
      contextUsageService.updateFromStatusLine('pty1', {
        context_window: { context_window_size: 200000, current_usage: 100000 },
        model: 'claude-sonnet-4-20250514',
      });
      const sl = contextUsageService.getAllStatusLine()['pty1'];
      expect(sl.model).toBe('claude-sonnet-4-20250514');
    });

    it('parses model as an object with display_name', () => {
      contextUsageService.updateFromStatusLine('pty1', {
        context_window: { context_window_size: 200000, current_usage: 100000 },
        model: { display_name: 'Claude Sonnet', id: 'claude-sonnet-4-20250514' },
      });
      const sl = contextUsageService.getAllStatusLine()['pty1'];
      expect(sl.model).toBe('Claude Sonnet');
    });

    it('parses model object falling back to id', () => {
      contextUsageService.updateFromStatusLine('pty1', {
        context_window: { context_window_size: 200000, current_usage: 100000 },
        model: { id: 'claude-sonnet-4-20250514' },
      });
      const sl = contextUsageService.getAllStatusLine()['pty1'];
      expect(sl.model).toBe('claude-sonnet-4-20250514');
    });

    it('handles malformed cost gracefully (non-numeric fields)', () => {
      contextUsageService.updateFromStatusLine('pty1', {
        context_window: { context_window_size: 200000, current_usage: 100000 },
        cost: {
          total_cost_usd: 'not a number' as unknown as number,
          total_duration_ms: null as unknown as number,
        },
      });
      const sl = contextUsageService.getAllStatusLine()['pty1'];
      expect(sl.cost).toEqual({
        totalCostUsd: 0,
        totalDurationMs: 0,
        totalApiDurationMs: 0,
        totalLinesAdded: 0,
        totalLinesRemoved: 0,
      });
    });
  });

  describe('unregister', () => {
    it('removes status line data for a PTY', () => {
      contextUsageService.updateFromStatusLine('pty1', {
        context_window: { context_window_size: 200000, current_usage: 100000 },
      });
      expect(contextUsageService.getAllStatusLine()['pty1']).toBeDefined();
      contextUsageService.unregister('pty1');
      expect(contextUsageService.getAllStatusLine()['pty1']).toBeUndefined();
    });
  });
});
