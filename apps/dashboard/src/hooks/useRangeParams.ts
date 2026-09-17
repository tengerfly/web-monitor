import { useMemo } from 'react';
import { resolveRange, useAppStore } from '../store/app';

/**
 * 组装所有查询接口共用的参数（应用 + 时间范围 + 环境）。
 * 统一在这里处理，避免每个页面各写一遍导致时间范围口径不一致。
 */
export function useRangeParams<T extends Record<string, any> = Record<string, never>>(
  extra?: T,
): { appKey: string; start: number; end: number; env?: string; appVersion?: string } & T {
  const appKey = useAppStore((state) => state.appKey);
  const env = useAppStore((state) => state.env);
  const appVersion = useAppStore((state) => state.appVersion);
  const preset = useAppStore((state) => state.preset);
  const customRange = useAppStore((state) => state.customRange);

  return useMemo(() => {
    const range = resolveRange({ preset, customRange });
    return { appKey, env, appVersion, ...range, ...(extra || ({} as T)) };
  }, [appKey, env, appVersion, preset, customRange, JSON.stringify(extra || {})]);
}

export default useRangeParams;
