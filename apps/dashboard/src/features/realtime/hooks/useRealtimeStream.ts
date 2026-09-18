import { useEffect, useRef, useState } from 'react';
import type { RealtimeScreenSnapshot } from '@web-monitor/types';
import { fetchSnapshot, isAppNotFound, streamUrl } from '../api';

/** 连接/数据通道状态（视图层派生态，不进入服务端契约） */
export type StreamPhase = 'idle' | 'connecting' | 'live' | 'interrupted';

export interface RealtimeStreamState {
  phase: StreamPhase;
  /** 是否至少成功拿到过一帧：区分「首次加载失败」（无时点）与「更新中断」（有最后时点） */
  everSucceeded: boolean;
  snapshot?: RealtimeScreenSnapshot;
  /** 应用不存在（已被删除）：404 判定 */
  appNotFound: boolean;
}

interface UseRealtimeStreamOptions {
  /** SSE 首帧等待上限（毫秒）：超过且从未成功 → 判定首次失败并启动 REST 兜底（FTDD §7.2） */
  firstFrameTimeoutMs?: number;
  /** REST 兜底轮询间隔（毫秒） */
  fallbackIntervalMs?: number;
  /** EventSource 工厂（测试注入用） */
  eventSourceFactory?: (url: string) => EventSource;
  /** 快照拉取器（测试注入用） */
  snapshotFetcher?: (appKey: string) => Promise<RealtimeScreenSnapshot>;
}

const FIRST_FRAME_TIMEOUT_MS = 5_000;
const FALLBACK_INTERVAL_MS = 5_000;

/**
 * 实时大屏数据流：SSE 为主、REST 快照兜底（FTDD D1/D3）。
 *
 * 状态机：
 * - connecting：已建流、尚未收到首帧；超 5s 未成功 → 启动 REST 兜底轮询
 * - live：SSE 正常供帧
 * - interrupted：连接断开但曾成功 → 保留旧快照 + 更新失败横幅，等待 EventSource 自动重连
 * - idle：未选定应用
 *
 * @param appKey 当前监控应用（undefined 时进入 idle）
 * @param options 测试注入项（工厂/间隔）
 */
export function useRealtimeStream(
  appKey: string | undefined,
  options: UseRealtimeStreamOptions = {},
): RealtimeStreamState {
  // options 用 ref 承载：默认参数每次渲染都是新函数引用，若进 useEffect 依赖会引发无限重渲染（OOM 教训）
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const {
    firstFrameTimeoutMs = FIRST_FRAME_TIMEOUT_MS,
    fallbackIntervalMs = FALLBACK_INTERVAL_MS,
    eventSourceFactory = (url) => new EventSource(url),
    snapshotFetcher = fetchSnapshot,
  } = optionsRef.current;

  const [state, setState] = useState<RealtimeStreamState>({
    phase: 'idle',
    everSucceeded: false,
    appNotFound: false,
  });

  /** 引用最新状态，避免在事件回调里读到旧闭包 */
  const everSucceededRef = useRef(false);
  const timerRefs = useRef<number[]>([]);

  useEffect(() => {
    if (!appKey) {
      setState({ phase: 'idle', everSucceeded: false, appNotFound: false });
      return;
    }

    everSucceededRef.current = false;
    setState({ phase: 'connecting', everSucceeded: false, appNotFound: false });

    const timers = timerRefs.current;
    const timersClear = (): void => {
      timers.forEach((id) => window.clearTimeout(id));
      timers.forEach((id) => window.clearInterval(id));
      timers.length = 0;
    };

    let disposed = false;
    let fallbackTimer: number | undefined;
    let source: EventSource | undefined;

    const applySnapshot = (snapshot: RealtimeScreenSnapshot): void => {
      everSucceededRef.current = true;
      setState({
        phase: 'live',
        everSucceeded: true,
        snapshot,
        appNotFound: false,
      });
    };

    const startFallbackPolling = (): void => {
      if (fallbackTimer !== undefined || disposed) return;
      fallbackTimer = window.setInterval(() => {
        snapshotFetcher(appKey)
          .then((snapshot) => {
            if (disposed) return;
            applySnapshot(snapshot);
          })
          .catch((error: unknown) => {
            if (disposed) return;
            if (isAppNotFound(error)) {
              timersClear();
              setState((prev) => ({ ...prev, phase: 'interrupted', appNotFound: true }));
            }
            // 其余错误维持 interrupted，等待下一轮兜底
          });
      }, fallbackIntervalMs);
      timers.push(fallbackTimer);
    };

    const connect = (): void => {
      source = eventSourceFactory(streamUrl(appKey));
      // 服务端 retry 帧已控制 EventSource 的自动重连节奏，error 时无需 close
      source.addEventListener('snapshot', (event: MessageEvent<string>) => {
        if (disposed) return;
        timersClear();
        try {
          applySnapshot(JSON.parse(event.data) as RealtimeScreenSnapshot);
        } catch {
          // 单帧解析失败不中断通道，等待下一帧
        }
      });
      source.addEventListener('error', () => {
        if (disposed) return;
        const fatal = source?.readyState === EventSource.CLOSED;
        if (everSucceededRef.current) {
          setState((prev) => ({ ...prev, phase: 'interrupted' }));
          // 致命关闭时兜底轮询接管（EventSource 不再自动重连）
          if (fatal) startFallbackPolling();
        } else {
          setState((prev) => ({ ...prev, phase: 'interrupted', appNotFound: prev.appNotFound }));
        }
      });
    };

    connect();

    // 首帧等待：超时且从未成功 → REST 兜底接管（SSE 可能被代理阻断）
    const firstFrameTimer = window.setTimeout(() => {
      if (!disposed && !everSucceededRef.current) {
        // 首帧等待超时：转「更新中断」态（无历史时点）并由 REST 兜底接管
        setState((prev) => ({ ...prev, phase: 'interrupted', appNotFound: prev.appNotFound }));
        startFallbackPolling();
      }
    }, firstFrameTimeoutMs);
    timers.push(firstFrameTimer);

    return () => {
      disposed = true;
      timersClear();
      source?.close();
    };
  }, [appKey]);

  return state;
}
