import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type RangePreset = '1h' | '6h' | '24h' | '7d' | '30d';

export const RANGE_PRESETS: Array<{ key: RangePreset; label: string; ms: number }> = [
  { key: '1h', label: '最近 1 小时', ms: 60 * 60 * 1000 },
  { key: '6h', label: '最近 6 小时', ms: 6 * 60 * 60 * 1000 },
  { key: '24h', label: '最近 24 小时', ms: 24 * 60 * 60 * 1000 },
  { key: '7d', label: '最近 7 天', ms: 7 * 24 * 60 * 60 * 1000 },
  { key: '30d', label: '最近 30 天', ms: 30 * 24 * 60 * 60 * 1000 },
];

interface AppState {
  appKey: string;
  appName: string;
  env?: string;
  appVersion?: string;
  preset: RangePreset;
  /** 自定义时间范围（毫秒），存在时优先于 preset */
  customRange?: [number, number];
  setProject: (payload: { appKey: string; name: string }) => void;
  setEnv: (env?: string) => void;
  setPreset: (preset: RangePreset) => void;
  setCustomRange: (range?: [number, number]) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      appKey: '',
      appName: '',
      env: undefined,
      appVersion: undefined,
      preset: '24h',
      customRange: undefined,
      setProject: ({ appKey, name }) => set({ appKey, appName: name }),
      setEnv: (env) => set({ env }),
      setPreset: (preset) => set({ preset, customRange: undefined }),
      setCustomRange: (customRange) => set({ customRange }),
    }),
    { name: 'wm-dashboard-app' },
  ),
);

/** 计算当前查询时间范围 */
export function resolveRange(state: Pick<AppState, 'preset' | 'customRange'>): {
  start: number;
  end: number;
} {
  if (state.customRange) {
    return { start: state.customRange[0], end: state.customRange[1] };
  }
  const preset = RANGE_PRESETS.find((item) => item.key === state.preset) || RANGE_PRESETS[2];
  const end = Date.now();
  return { start: end - preset.ms, end };
}

/** 组装查询参数（所有接口共用） */
export function buildQueryParams(): Record<string, any> {
  const state = useAppStore.getState();
  const range = resolveRange(state);
  return {
    appKey: state.appKey,
    env: state.env,
    appVersion: state.appVersion,
    start: range.start,
    end: range.end,
  };
}
