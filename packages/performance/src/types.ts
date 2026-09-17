import type { PerformanceOptions } from '@web-monitor/types';

export type PerformanceCollectorOptions = PerformanceOptions;

export interface ResolvedPerformanceOptions
  extends Required<Omit<PerformanceOptions, 'thresholds'>> {
  thresholds: Record<string, number>;
}

export const DEFAULT_PERFORMANCE_OPTIONS: ResolvedPerformanceOptions = {
  enabled: true,
  sampleRate: 1,
  resource: true,
  slowResourceThreshold: 500,
  longTask: true,
  fps: true,
  memory: true,
  api: true,
  slowApiThreshold: 1000,
  whiteScreen: true,
  memoryInterval: 30000,
  thresholds: {
    LCP: 2500,
    INP: 200,
    CLS: 0.1,
    FCP: 1800,
    TTFB: 800,
    FID: 100,
  },
};

/** 性能指标评级 */
export type MetricRating = 'good' | 'needs-improvement' | 'poor';

/** 指标的「良好 / 需改进」阈值（左良好，右较差） */
export const RATING_THRESHOLDS: Record<string, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
  FID: [100, 300],
  FP: [1800, 3000],
  FMP: [2500, 4000],
  TTI: [3800, 7300],
  TBT: [200, 600],
  FPS: [50, 30],
};

export function rateMetric(metric: string, value: number): MetricRating {
  const thresholds = RATING_THRESHOLDS[metric];
  if (!thresholds) return 'good';
  const [good, poor] = thresholds;
  // FPS 越大越好，需要反向判断
  if (metric === 'FPS') {
    if (value >= good) return 'good';
    if (value >= poor) return 'needs-improvement';
    return 'poor';
  }
  if (value <= good) return 'good';
  if (value <= poor) return 'needs-improvement';
  return 'poor';
}

/** 性能总分（0-100），按各指标评级加权 */
export function computeScore(metrics: Record<string, number>): number {
  const weights: Record<string, number> = {
    LCP: 0.3,
    INP: 0.25,
    CLS: 0.2,
    FCP: 0.15,
    TTFB: 0.1,
  };
  let score = 0;
  let totalWeight = 0;
  for (const [metric, weight] of Object.entries(weights)) {
    const value = metrics[metric];
    if (value === undefined) continue;
    const rating = rateMetric(metric, value);
    score += (rating === 'good' ? 100 : rating === 'needs-improvement' ? 60 : 20) * weight;
    totalWeight += weight;
  }
  if (!totalWeight) return 0;
  return Math.round(score / totalWeight);
}
