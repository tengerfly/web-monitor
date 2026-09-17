import type { BehaviorOptions } from '@web-monitor/types';

export type { BehaviorOptions };

export interface ResolvedBehaviorOptions {
  enabled: boolean;
  sampleRate: number;
  pv: boolean;
  route: boolean;
  click: boolean;
  clickRoot?: string;
  clickTargets: string[];
  exposure: boolean;
  exposureTargets: string[];
  exposureRatio: number;
  scroll: boolean;
  scrollThrottle: number;
  form: boolean;
  formValue: boolean;
  console: boolean;
  consoleLevels: Array<'log' | 'info' | 'warn' | 'error'>;
  stay: boolean;
}

export const DEFAULT_BEHAVIOR_OPTIONS: ResolvedBehaviorOptions = {
  enabled: true,
  sampleRate: 1,
  pv: true,
  route: true,
  click: true,
  clickRoot: undefined,
  clickTargets: [],
  exposure: false,
  exposureTargets: [],
  exposureRatio: 0.5,
  scroll: true,
  scrollThrottle: 500,
  form: true,
  formValue: false,
  console: false,
  consoleLevels: ['error', 'warn'],
  stay: true,
};

export function resolveBehaviorOptions(
  options: BehaviorOptions = {},
): ResolvedBehaviorOptions {
  return {
    ...DEFAULT_BEHAVIOR_OPTIONS,
    ...options,
    clickTargets: options.clickTargets || DEFAULT_BEHAVIOR_OPTIONS.clickTargets,
    exposureTargets: options.exposureTargets || DEFAULT_BEHAVIOR_OPTIONS.exposureTargets,
    consoleLevels: options.consoleLevels || DEFAULT_BEHAVIOR_OPTIONS.consoleLevels,
  };
}
