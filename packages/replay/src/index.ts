import { definePlugin, type MonitorContext } from '@web-monitor/core';
import type { ReplayOptions } from '@web-monitor/types';
import { DEFAULT_REPLAY_OPTIONS, type ResolvedReplayOptions } from './types';
import { ReplayCollector } from './recorder';

export * from './types';
export { NodeRegistry, serializeNode, serializeDocument } from './snapshot';
export { maskString, shouldMaskElement, shouldBlockElement, maskAttributes } from './mask';
export { ReplayCollector } from './recorder';
export {
  ReplayPlayer,
  type ReplayPlayerOptions,
  type ReplayPlayerEventName,
} from './player';

export interface ReplayPluginApi {
  /** 手动冲刷当前分片 */
  flush(): void;
  /** 是否正在录制（未命中采样时为 false） */
  isRecording(): boolean;
}

const PLUGIN_NAME = 'replay';

/**
 * 会话回放插件。
 *
 * 成本提示：回放数据量远大于埋点数据，默认采样率 10%，
 * 并建议在生产环境配合 `onlyOnError`（仅在检出错误后保留）与较短的存储 TTL。
 */
export function replayPlugin(options: ReplayOptions = {}) {
  const localOptions: ResolvedReplayOptions = {
    ...DEFAULT_REPLAY_OPTIONS,
    ...options,
    maskSelectors: options.maskSelectors || DEFAULT_REPLAY_OPTIONS.maskSelectors,
    blockSelectors: options.blockSelectors || DEFAULT_REPLAY_OPTIONS.blockSelectors,
  };

  return definePlugin<ReplayOptions>(
    PLUGIN_NAME,
    (ctx: MonitorContext) => {
      if (!ctx.isPluginEnabled(PLUGIN_NAME)) {
        ctx.logger.info('replay plugin disabled by config');
        return;
      }

      const remote = ctx.getRuntimeConfig<ReplayOptions>(PLUGIN_NAME, options);
      const opts: ResolvedReplayOptions = {
        ...localOptions,
        ...remote,
        maskSelectors: remote.maskSelectors || localOptions.maskSelectors,
        blockSelectors: remote.blockSelectors || localOptions.blockSelectors,
      };

      const collector = ctx.defineCollector(new ReplayCollector(opts));

      const api: ReplayPluginApi = {
        flush: () => collector.flush(),
        isRecording: () => collector.isRecording(),
      };
      const target = ctx as unknown as Record<string, any>;
      target.replay = api;

      ctx.logger.debug('replay plugin installed', {
        sampleRate: opts.sampleRate,
        maskAllInputs: opts.maskAllInputs,
        flushInterval: opts.flushInterval,
      });
    },
    options,
  );
}
