import type { ReplayOptions } from '@web-monitor/types';

export type { ReplayOptions };

export interface ResolvedReplayOptions {
  enabled: boolean;
  sampleRate: number;
  flushInterval: number;
  maxEventsPerChunk: number;
  maskAllInputs: boolean;
  maskAllText: boolean;
  maskSelectors: string[];
  blockSelectors: string[];
  recordMouseMove: boolean;
  recordCanvas: boolean;
  onlyOnError: boolean;
}

export const DEFAULT_REPLAY_OPTIONS: ResolvedReplayOptions = {
  enabled: true,
  sampleRate: 0.1,
  flushInterval: 10000,
  maxEventsPerChunk: 1000,
  maskAllInputs: true,
  maskAllText: false,
  maskSelectors: [],
  blockSelectors: [],
  recordMouseMove: true,
  recordCanvas: false,
  onlyOnError: false,
};

export interface MaskContext {
  maskAllInputs: boolean;
  maskAllText: boolean;
  maskSelectors: string[];
  blockSelectors: string[];
}

export const MASK_CHAR = '*';

/** 元素属性遮罩标记 */
export const ATTR_MASK = 'data-wm-mask';
/** 元素忽略标记 */
export const ATTR_IGNORE = 'data-wm-ignore';
