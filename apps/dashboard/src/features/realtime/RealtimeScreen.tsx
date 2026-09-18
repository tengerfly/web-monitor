import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RealtimeScreenSnapshot } from '@web-monitor/types';
import { fetchProjects } from '../../api/endpoints';
import { useRealtimeStream } from './hooks/useRealtimeStream';
import { usePrevFingerprints } from './hooks/usePrevFingerprints';
import {
  AlertBanner,
  AppSwitcherBar,
  ErrorStream,
  MetricCards,
  StatusBanners,
  TopLists,
} from './components/blocks';
import { TrendPanel } from './components/TrendPanel';
import { VitalsRing } from './components/VitalsRing';
import styles from './realtime.module.css';
import './theme.css';

/** 醒目指标键计算：未恢复告警的 metric 枚举 → metrics 字段（A11；未覆盖枚举不醒目） */
function computeHotKeys(unresolvedMetrics: string[]): Set<string> {
  const metricToKey: Record<string, string> = {
    error_rate: 'errorRate',
    error_count: 'errorCount',
    new_error: 'errorCount',
    api_error_rate: 'apiSuccessRate',
    p95_latency: 'score',
    lcp_p75: 'score',
  };
  const keys = new Set<string>();
  for (const metric of unresolvedMetrics) {
    const key = metricToKey[metric];
    if (key) keys.add(key);
  }
  return keys;
}

/**
 * 实时大屏页面容器（FTDD 01 模块）：编排七区块与状态机分支，逻辑全部在 hooks。
 */
export default function RealtimeScreen() {
  const { data: projects } = useQuery({ queryKey: ['projects'], queryFn: fetchProjects, staleTime: 5 * 60_000 });
  const apps = useMemo(
    () => (projects ?? []).map((project) => ({ appKey: project.appKey, name: project.name })),
    [projects],
  );
  // 默认选中第一个应用；切换后仅本页生效，与全局 store 解耦（PRD M02 §5.1 / A9）
  const [appKey, setAppKey] = useState<string | undefined>(undefined);
  const effectiveAppKey = appKey ?? apps[0]?.appKey;

  const stream = useRealtimeStream(effectiveAppKey);
  const { phase, everSucceeded, snapshot, appNotFound } = stream;

  const fingerprints = useMemo(
    () => (snapshot?.errors ?? []).map((error) => error.fingerprint),
    [snapshot?.errors],
  );
  const { prev: prevFingerprints, initialized: fingerprintBaselineReady } = usePrevFingerprints(fingerprints);
  // 「新」= 当前帧存在而上一轮不存在的条目；首帧只建基线不标新（A12）
  const newFingerprints = useMemo(
    () => (fingerprintBaselineReady ? new Set(fingerprints.filter((fp) => !prevFingerprints.has(fp))) : new Set<string>()),
    [fingerprintBaselineReady, fingerprints, prevFingerprints],
  );
  const hotKeys = useMemo(() => computeHotKeys((snapshot?.alerts.unresolved ?? []).map((item) => item.metric)), [
    snapshot?.alerts.unresolved,
  ]);

  if (apps.length === 0) {
    return (
      <div className="realtime-screen">
        <div className={styles.shell}>
          <div className={styles.emptyApp}>
            <h2 className={styles.emptyTitle}>还没有接入应用</h2>
            <p className={styles.emptyDesc}>接入第一个前端应用后，即可在这里实时查看它的线上健康度。</p>
            <a className={styles.emptyLink} href="/connect">
              去接入应用
            </a>
          </div>
        </div>
      </div>
    );
  }

  const noData = snapshot !== undefined && snapshot.failure.status !== 'failed' && snapshot.metrics.pv === 0;
  const showEmptyBlocks = phase === 'interrupted' && !everSucceeded;

  return (
    <div className="realtime-screen">
      <div className={styles.shell}>
        <StatusBanners phase={phase} everSucceeded={everSucceeded} appNotFound={appNotFound} lastSuccessAt={snapshot?.failure.lastSuccessAt} />

        <AppSwitcherBar
          apps={apps}
          appKey={effectiveAppKey ?? ''}
          onAppChange={setAppKey}
          snapshot={snapshot}
          phase={phase}
          everSucceeded={everSucceeded}
          appNotFound={appNotFound}
        />

        <AlertBanner alerts={snapshot?.alerts.unresolved ?? []} />

        {showEmptyBlocks ? (
          <div className={styles.zoneEmpty} role="status">
            暂无已加载数据
          </div>
        ) : (
          <>
            <MetricCards metrics={snapshot?.metrics ?? { pv: 0, uv: 0, errorCount: 0, errorRate: 0, score: 0, activeSessions: 0, apiSuccessRate: 0 }} hotKeys={hotKeys} />

            <div className={styles.row} style={{ marginBottom: 'var(--space-3)' }}>
              <div className={styles.colMain}>
                <TrendBody snapshot={snapshot} noData={noData} />
              </div>
            </div>

            <div className={styles.row}>
              <section className={`${styles.panel} ${styles.colMain}`} aria-label="错误滚动流">
                <div className={styles.panelHead}>
                  <h2 className={styles.panelTitle}>错误滚动流 · 最新 50 条（倒序）</h2>
                </div>
                <ErrorStream
                  errors={snapshot?.errors ?? []}
                  newFingerprints={newFingerprints}
                  emptyText={noData ? '暂无错误数据——该应用尚未产生上报' : '暂无已加载数据'}
                />
              </section>

              <div className={styles.colSide}>
                <section className={styles.panel} aria-label="Top 榜">
                  <h2 className={styles.panelTitle}>Top 榜</h2>
                  <TopLists
                    topLists={
                      snapshot?.topLists ?? { slowApis: [], jsErrors: [], worstPages: [] }
                    }
                  />
                </section>

                <section className={styles.panel} aria-label="Core Vitals 达标率">
                  <h2 className={styles.panelTitle}>Core Vitals 达标率</h2>
                  {snapshot?.vitals ? (
                    <VitalsRing vitals={snapshot.vitals} />
                  ) : (
                    <div className={styles.zoneEmpty} role="status">
                      无性能样本——达标率暂不可算
                    </div>
                  )}
                </section>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 趋势体：无数据空态 / 正常曲线（从容器拆出避免 TrendPanel 空态与数据双路径耦合） */
function TrendBody(props: { snapshot?: RealtimeScreenSnapshot; noData: boolean }) {
  const { snapshot, noData } = props;
  if (noData) {
    return (
      <div className={styles.zoneEmpty} role="status">
        暂无数据——该应用尚未产生上报
      </div>
    );
  }
  if (!snapshot) {
    return (
      <div className={styles.zoneEmpty} role="status">
        暂无已加载数据
      </div>
    );
  }
  return <TrendPanel trend={snapshot.trend} empty={false} />;
}
