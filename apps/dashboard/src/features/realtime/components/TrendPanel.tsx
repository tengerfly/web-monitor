import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import type { RealtimeScreenSnapshot } from '@web-monitor/types';
import styles from '../realtime.module.css';

/** 趋势双曲线（访问量=primary、错误数=danger），深色 token 配置 */
export function TrendPanel(props: { trend: RealtimeScreenSnapshot['trend']; empty: boolean }) {
  const { trend, empty } = props;

  const option = useMemo(
    () => ({
      animation: false,
      grid: { left: 8, right: 8, top: 16, bottom: 24, containLabel: true },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#1e2a45' } },
        axisLabel: { color: '#55617a', fontSize: 11, formatter: (value: string) => value.slice(11, 16) },
        axisTick: { show: false },
      },
      yAxis: [
        { type: 'value', splitLine: { lineStyle: { color: '#1e2a45' } }, axisLabel: { show: false } },
        { type: 'value', splitLine: { show: false }, axisLabel: { show: false } },
      ],
      series: [
        {
          name: '访问量',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: trend.map((point) => [
            new Date(point.minuteEpochMs).toISOString().slice(0, 16).replace('T', ' '),
            point.pv,
          ]),
          lineStyle: { color: '#60a5fa', width: 2 },
          itemStyle: { color: '#60a5fa' },
          areaStyle: { color: 'rgba(96,165,250,0.08)' },
        },
        {
          name: '错误数',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          showSymbol: false,
          data: trend.map((point) => [
            new Date(point.minuteEpochMs).toISOString().slice(0, 16).replace('T', ' '),
            point.errors,
          ]),
          lineStyle: { color: '#f87171', width: 2 },
          itemStyle: { color: '#f87171' },
        },
      ],
    }),
    [trend],
  );

  return (
    <section className={styles.panel} aria-label="实时趋势">
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>实时趋势 · 最近 60 分钟</h2>
        <span className={styles.legend}>
          <span>
            <i className={styles.legendLine} style={{ background: 'var(--color-primary)' }} />
            访问量
          </span>
          <span>
            <i className={styles.legendLine} style={{ background: 'var(--color-danger)' }} />
            错误数
          </span>
        </span>
      </div>
      {empty ? (
        <div className={styles.zoneEmpty} role="status">
          暂无数据——该应用尚未产生上报
        </div>
      ) : (
        <ReactECharts option={option} notMerge style={{ height: 200, width: '100%' }} lazyUpdate />
      )}
    </section>
  );
}
