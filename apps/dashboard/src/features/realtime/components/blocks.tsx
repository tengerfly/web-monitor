import { useState } from 'react';
import type { RealtimeScreenSnapshot, ScreenAlertItem, ScreenErrorItem, ScreenTopItem } from '@web-monitor/types';
import styles from '../realtime.module.css';

/** 视图模型：ISO 时间 → 「今天 HH:mm」展示文案（服务端时区口径） */
export function formatOccurTime(iso: string): string {
  const date = new Date(iso);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `今天 ${hh}:${mm}`;
}

/** Top 榜数值按单位格式化 */
export function formatTopValue(item: ScreenTopItem): string {
  return item.unit === 'ms' ? `${Math.round(item.value).toLocaleString()}ms` : `${item.value} 次`;
}

/** 告警当前值格式化：比率类指标按百分数、其余原值（与触发时口径一致） */
export function formatAlertValue(metric: string, value: number): string {
  const percentMetrics = new Set(['error_rate', 'api_error_rate']);
  return percentMetrics.has(metric) ? `${value}%` : String(value);
}

/** 告警指标枚举 → 展示名（与设计稿「命中指标 错误率」对齐） */
export const METRIC_NAMES: Record<string, string> = {
  error_rate: '错误率',
  error_count: '错误数',
  new_error: '新错误',
  affected_users: '影响用户',
  p95_latency: 'P95 延迟',
  api_error_rate: '接口错误率',
  lcp_p75: 'LCP P75',
  white_screen: '白屏',
  slow_api_count: '慢接口数',
};

/** 应用切换区：下拉 + 统计时点 + 更新状态徽标 + 加载中标识 */
export function AppSwitcherBar(props: {
  apps: Array<{ appKey: string; name: string }>;
  appKey: string;
  onAppChange: (appKey: string) => void;
  snapshot?: RealtimeScreenSnapshot;
  phase: 'connecting' | 'live' | 'interrupted' | 'idle';
  everSucceeded: boolean;
  appNotFound: boolean;
}) {
  const { apps, appKey, onAppChange, snapshot, phase, everSucceeded, appNotFound } = props;
  const failed = phase === 'interrupted' && everSucceeded;
  const firstFail = phase === 'interrupted' && !everSucceeded;
  const timeText = appNotFound ? '—' : (snapshot?.generatedAt.slice(11, 16) ?? '');
  return (
    <section className={styles.panel} aria-label="应用切换区">
      <div className={styles.ctrl}>
        <label className={styles.ctrlLabel} htmlFor="realtime-app-select">
          监控应用
        </label>
        <select
          id="realtime-app-select"
          className={styles.ctrlSelect}
          value={appKey}
          onChange={(event) => onAppChange(event.target.value)}
        >
          {apps.map((app) => (
            <option key={app.appKey} value={app.appKey}>
              {app.name}（{app.appKey}）
            </option>
          ))}
        </select>
        <span className={styles.clock}>
          数据统计时点 <b className={styles.clockTime}>{firstFail ? '暂无已加载数据' : timeText}</b> 服务端时间
        </span>
        {appNotFound || firstFail ? null : failed ? (
          <span className={`${styles.badge} ${styles.badgeFail}`}>✕ 更新失败（自动重试中）</span>
        ) : phase === 'live' || phase === 'connecting' ? (
          <span className={`${styles.badge} ${styles.badgeOk}`}>
            <span className={styles.dot} /> 正常更新中
          </span>
        ) : null}
        {phase === 'connecting' ? <span className={styles.loadingTag}>加载中…</span> : null}
      </div>
    </section>
  );
}

/** 更新失败/首次失败/应用被删横幅 */
export function StatusBanners(props: {
  phase: 'connecting' | 'live' | 'interrupted' | 'idle';
  everSucceeded: boolean;
  appNotFound: boolean;
  lastSuccessAt?: string;
}) {
  const { phase, everSucceeded, appNotFound, lastSuccessAt } = props;
  if (appNotFound) {
    return (
      <div className={`${styles.banner} ${styles.bannerAppDeleted}`} role="alert">
        该应用不可用（可能已被删除）。请在上方切换到其他应用继续观察。
      </div>
    );
  }
  if (phase !== 'interrupted') return null;
  return (
    <div className={`${styles.banner} ${styles.bannerFail}`} role="alert">
      {everSucceeded ? (
        <>
          ✕ 数据更新失败：以下内容为最后成功数据。最后成功统计时点{' '}
          <b className={styles.clockTime}>{lastSuccessAt?.slice(11, 16) ?? '—'}</b> 服务端时间。自动重试中，恢复后将自动刷新，
          无需手动操作。
        </>
      ) : (
        '✕ 首次加载失败：暂无已加载数据（无历史统计时点）。正在自动重试，成功后将自动呈现各区块。'
      )}
    </div>
  );
}

/** 告警横幅：仅未恢复告警上墙；无未恢复告警整体不渲染（PRD A5） */
export function AlertBanner(props: { alerts: ScreenAlertItem[] }) {
  const { alerts } = props;
  if (!alerts.length) return null;
  return (
    <section className={styles.alerts} aria-label="告警横幅">
      <div className={styles.alertsHead}>告警 · 未恢复（滚动提示，点击定位到该告警）</div>
      {alerts.map((alert) => (
        <a
          key={alert.id}
          className={styles.alertItem}
          href="/alerts"
          target="_blank"
          rel="noopener"
          aria-label={`查看告警 ${alert.ruleName}`}
        >
          <span>
            <span className={styles.alertRule}>{alert.ruleName}</span> · 命中指标 {METRIC_NAMES[alert.metric] ?? alert.metric} · 当前值（触发时）{' '}
            {formatAlertValue(alert.metric, alert.value)}（阈值 {formatAlertValue(alert.metric, alert.threshold)}）
          </span>
          <span className={styles.alertMeta}>触发于 {formatOccurTime(alert.triggeredAt).replace('今天 ', '')}</span>
        </a>
      ))}
    </section>
  );
}

/** 核心指标卡：7 张；醒目卡=daily 值命中未恢复告警阈值的指标（A11，hotKeys 由容器计算） */
export function MetricCards(props: { metrics: RealtimeScreenSnapshot['metrics']; hotKeys: Set<string> }) {
  const { metrics, hotKeys } = props;
  const cards: Array<{ name: string; value: string; key: string; success?: boolean }> = [
    { name: '当日 PV', value: metrics.pv.toLocaleString(), key: 'pv' },
    { name: '当日 UV', value: metrics.uv.toLocaleString(), key: 'uv' },
    { name: '错误数', value: String(metrics.errorCount), key: 'errorCount' },
    { name: '错误率', value: `${(metrics.errorRate * 100).toFixed(2)}%`, key: 'errorRate' },
    { name: '性能评分', value: String(metrics.score), key: 'score' },
    { name: '活跃会话', value: String(metrics.activeSessions), key: 'activeSessions' },
    { name: '接口成功率', value: `${(metrics.apiSuccessRate * 100).toFixed(1)}%`, key: 'apiSuccessRate', success: true },
  ];
  return (
    <div className={styles.kpis} aria-label="核心指标卡">
      {cards.map((card) => (
        <div key={card.key} className={styles.kpi}>
          <div className={styles.kpiName}>{card.name}</div>
          <div className={`${styles.kpiVal} ${hotKeys.has(card.key) ? styles.kpiValHot : ''} ${card.success ? styles.kpiSuccess : ''}`}>
            {card.value}
          </div>
          {hotKeys.has(card.key) ? <div className={styles.kpiHotBar} /> : null}
        </div>
      ))}
    </div>
  );
}

/** 单条错误行：主链接区（新开视图跳详情）与「查看完整」按钮分离（按钮不得嵌套于链接） */
function ErrorRow(props: { error: ScreenErrorItem; isNew: boolean }) {
  const { error, isNew } = props;
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={styles.errItem}>
      <a
        className={styles.errLink}
        href={`/errors/${encodeURIComponent(error.fingerprint)}`}
        target="_blank"
        rel="noopener"
        aria-label={`新开视图查看错误详情：${error.message}`}
      >
        <div className={styles.errHead}>
          <span className={styles.errType}>
            {error.type}
            {isNew ? <span className={styles.badgeNew}>新</span> : null}
          </span>
          <span className={styles.errTime}>{formatOccurTime(error.occurredAt)}</span>
        </div>
        <div className={styles.errMsg}>{error.message}</div>
        <div className={styles.errPage}>页面 {error.page}</div>
      </a>
      <button
        type="button"
        className={styles.errToggle}
        aria-label={expanded ? '收起完整消息' : '查看完整消息'}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? '收起' : '查看完整'}
      </button>
      {expanded ? (
        <div className={styles.errFull} role="note">
          {error.message}
        </div>
      ) : null}
    </div>
  );
}

/** 错误滚动流：最新 50 条倒序；「新」= 与上一轮快照比对新出现（A12，高亮一轮） */
export function ErrorStream(props: { errors: ScreenErrorItem[]; newFingerprints: Set<string>; emptyText: string }) {
  const { errors, newFingerprints, emptyText } = props;
  if (!errors.length) {
    return (
      <div className={styles.zoneEmpty} role="status">
        {emptyText}
      </div>
    );
  }
  return (
    <div>
      {errors.map((error) => (
        <ErrorRow key={`${error.fingerprint}-${error.occurredAt}`} error={error} isNew={newFingerprints.has(error.fingerprint)} />
      ))}
    </div>
  );
}

/** 三个 Top 榜（慢接口 / JS 错误 / 最差页面） */
export function TopLists(props: { topLists: RealtimeScreenSnapshot['topLists'] }) {
  const { topLists } = props;
  const columns: Array<{ title: string; items: ScreenTopItem[] }> = [
    { title: '慢接口 Top5', items: topLists.slowApis },
    { title: 'JS 错误 Top5', items: topLists.jsErrors },
    { title: '最差页面 Top5', items: topLists.worstPages },
  ];
  return (
    <div className={styles.topCols}>
      {columns.map((column) => (
        <div key={column.title}>
          <h3 className={styles.topTitle}>{column.title}</h3>
          <ul className={styles.topList}>
            {column.items.length ? (
              column.items.map((item, index) => (
                <li key={`${item.name}-${index}`} className={styles.topItem}>
                  <span className={styles.topIndex}>{index + 1}</span>
                  <span className={styles.topName}>{item.name}</span>
                  <span className={styles.topValue}>{formatTopValue(item)}</span>
                </li>
              ))
            ) : (
              <li className={styles.topItem} style={{ color: 'var(--color-text-tertiary)' }}>
                暂无数据
              </li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}
