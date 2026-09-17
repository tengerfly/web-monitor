import React, {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { createMonitor, type Monitor, type MonitorOptions } from '@web-monitor/core';

const MonitorContext = createContext<Monitor | null>(null);

export interface MonitorProviderProps {
  /** 外部已创建的实例（优先级最高，适合在应用入口统一初始化） */
  monitor?: Monitor;
  /** 未传实例时按此配置创建 */
  options?: MonitorOptions;
  /** 挂载时自动 start */
  autoStart?: boolean;
  children?: ReactNode;
}

/**
 * 监控上下文 Provider。
 * 推荐在应用入口创建实例并传入，避免热更新导致重复初始化。
 */
export function MonitorProvider(props: MonitorProviderProps): React.ReactElement {
  const { monitor, options, autoStart = true, children } = props;
  const instanceRef = useRef<Monitor | null>(null);
  const createdOptionsRef = useRef<MonitorOptions | undefined>(undefined);

  if (!instanceRef.current) {
    if (monitor) {
      instanceRef.current = monitor;
    } else if (options) {
      createdOptionsRef.current = options;
      instanceRef.current = createMonitor(options);
    }
  }

  useEffect(() => {
    const instance = instanceRef.current;
    if (instance && autoStart && !instance.isStarted()) instance.start();
    return () => {
      // 由创建者决定是否销毁：这里只做冲刷，避免热更新后实例不可用
      instanceRef.current?.flush();
    };
  }, [autoStart]);

  return (
    <MonitorContext.Provider value={instanceRef.current}>{children}</MonitorContext.Provider>
  );
}

/** 获取监控实例（未提供 Provider 时返回 null，不抛错以避免打断渲染） */
export function useMonitor(): Monitor | null {
  return useContext(MonitorContext);
}

/** 埋点 Hook */
export function useTrack(): (
  eventName: string,
  properties?: Record<string, any>,
  category?: string,
) => void {
  const monitor = useMonitor();
  return useCallback(
    (eventName: string, properties: Record<string, any> = {}, category?: string) => {
      monitor?.track(eventName, properties, category);
    },
    [monitor],
  );
}

/** 性能指标 Hook */
export function useReportMetric(): (
  metric: string,
  value: number,
  options?: { unit?: string; tags?: Record<string, string | number> },
) => void {
  const monitor = useMonitor();
  return useCallback(
    (metric: string, value: number, options?: { unit?: string; tags?: Record<string, string | number> }) => {
      monitor?.reportMetric(metric, value, options);
    },
    [monitor],
  );
}

export interface MonitorErrorBoundaryProps {
  children: ReactNode;
  /** 自定义降级 UI */
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  /** 错误上报后回调 */
  onError?: (error: Error, info: ErrorInfo) => void;
  level?: string;
}

interface BoundaryState {
  error: Error | null;
}

/**
 * 错误边界：把 React 渲染期错误交给监控上报（含组件栈，这是 React 场景独有且极其有用的溯源信息）。
 */
export class MonitorErrorBoundary extends Component<MonitorErrorBoundaryProps, BoundaryState> {
  static override contextType = MonitorContext;
  declare context: Monitor | null;

  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const monitor = this.context || (this.props as any).monitor;
    try {
      monitor?.reportError(error, {
        componentStack: info.componentStack,
        mechanism: 'react-error-boundary',
      }, this.props.level);
    } catch {
      /* 自保护 */
    }
    this.props.onError?.(error, info);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { fallback } = this.props;
    if (typeof fallback === 'function') return fallback(error, this.reset);
    if (fallback !== undefined) return fallback;
    return (
      <div role="alert" style={{ padding: 16, color: '#b42318' }}>
        页面出现异常，已自动上报，请刷新重试。
      </div>
    );
  }
}

/**
 * 路由埋点 Hook（React Router / Next Router 通用）。
 * 传入当前 pathname，路由变化时通知监控实例，进而触发 PV 与路由性能采集。
 */
export function usePageView(pathname: string, search?: string): void {
  const monitor = useMonitor();
  const previous = useRef<string>('');

  useEffect(() => {
    if (!monitor || !pathname || previous.current === pathname) return;
    previous.current = pathname;
    monitor.setUserContext({ __page: pathname });
    monitor.router.notify();
    if (search) monitor.track('page_view', { path: pathname, search }, 'navigation');
  }, [monitor, pathname, search]);
}

export { createMonitor, MonitorContext };
export type { Monitor, MonitorOptions };
