import { ErrorLevel, type ErrorOptions } from '@web-monitor/types';

export type { ErrorOptions };

export interface ResolvedErrorOptions
  extends Required<Omit<ErrorOptions, 'ignoreErrors' | 'beforeSend' | 'businessCodeExtractor' | 'minLevel'>> {
  minLevel: ErrorLevel | string;
  ignoreErrors: Array<string | RegExp>;
  beforeSend?: (payload: any) => any | null;
  businessCodeExtractor?: (data: any) => string | number | undefined | void;
}

export const DEFAULT_ERROR_OPTIONS: Omit<ResolvedErrorOptions, 'minLevel'> & {
  minLevel: ErrorLevel;
} = {
  enabled: true,
  sampleRate: 1,
  minLevel: ErrorLevel.Warning,
  maxBreadcrumbs: 20,
  snapshot: true,
  resourceError: true,
  requestError: true,
  consoleError: false,
  ignoreErrors: [],
};

/** 级别严重度（数值越大越严重） */
export const LEVEL_SEVERITY: Record<string, number> = {
  [ErrorLevel.Fatal]: 4,
  [ErrorLevel.Error]: 3,
  [ErrorLevel.Warning]: 2,
  [ErrorLevel.Info]: 1,
};

export function severityOf(level?: string): number {
  return LEVEL_SEVERITY[level || ErrorLevel.Error] ?? 3;
}
