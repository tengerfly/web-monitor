import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RealtimeScreenSnapshot, ScreenAlertItem, ScreenErrorItem } from '@web-monitor/types';
import { AlertBanner, ErrorStream, MetricCards, StatusBanners, TopLists } from './components/blocks';
import { VitalsRing } from './components/VitalsRing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const alert: ScreenAlertItem = {
  id: 'a1',
  ruleName: '错误率突增',
  metric: 'error_rate',
  value: 2.4,
  threshold: 2,
  triggeredAt: '2026-09-18T14:20:00',
  status: 'firing',
};

const errorItem: ScreenErrorItem = {
  fingerprint: 'fp-1',
  type: 'JS 错误',
  message: 'TypeError: Cannot read properties of undefined (reading \'total\')',
  page: '/order/confirm',
  occurredAt: '2026-09-18T14:30:00',
};

describe('实时大屏区块渲染（TC-M02 ↔ AC-M02-003/006/007/009/012/013）', () => {
  it('TC-M02-006 未恢复告警渲染横幅五要素；无告警不渲染', () => {
    render(<AlertBanner alerts={[alert]} />);
    expect(screen.getByText(/错误率突增/)).toBeTruthy();
    expect(screen.getByText(/当前值（触发时） 2.4%（阈值 2%）/)).toBeTruthy();
    const { container } = render(<AlertBanner alerts={[]} />);
    expect(container.querySelector('section')).toBeNull();
  });

  it('TC-M02-003 指标卡七张且命中阈值的错误率卡醒目', () => {
    render(
      <MetricCards
        metrics={{ pv: 12847, uv: 3421, errorCount: 23, errorRate: 0.0018, score: 86, activeSessions: 214, apiSuccessRate: 0.996 }}
        hotKeys={new Set(['errorRate'])}
      />,
    );
    expect(screen.getByText('当日 PV')).toBeTruthy();
    expect(screen.getByText('12,847')).toBeTruthy();
    expect(screen.getByText('0.18%')).toBeTruthy();
  });

  it('TC-M02-012 错误流渲染条目且提供完整消息展开', () => {
    render(<ErrorStream errors={[errorItem]} newFingerprints={new Set(['fp-1'])} emptyText="暂无" />);
    expect(screen.getByRole('button', { name: '查看完整消息' })).toBeTruthy();
    expect(screen.getByText(/TypeError/)).toBeTruthy();
    expect(screen.getByLabelText(/新开视图查看错误详情/)).toBeTruthy();
  });

  it('TC-M02-005 空错误流按正常态文案展示', () => {
    render(<ErrorStream errors={[]} newFingerprints={new Set()} emptyText="暂无错误数据——该应用尚未产生上报" />);
    expect(screen.getByText('暂无错误数据——该应用尚未产生上报')).toBeTruthy();
  });

  it('TC-M02-003 Top 榜三列渲染且空榜单显示暂无数据', () => {
    render(
      <TopLists
        topLists={{
          slowApis: [{ name: '/api/order/list', value: 1842, unit: 'ms' }],
          jsErrors: [{ name: 'fp-1', value: 18, unit: 'count' }],
          worstPages: [],
        }}
      />,
    );
    expect(screen.getByText('慢接口 Top5')).toBeTruthy();
    expect(screen.getByText('1,842ms')).toBeTruthy();
    expect(screen.getAllByText('暂无数据').length).toBe(1);
  });

  it('TC-M02-009 达标率：有样本渲染三环+综合，无样本展示占位', () => {
    render(<VitalsRing vitals={{ lcp: 0.92, inp: 0.88, cls: 0.96, overall: 0.9 }} />);
    expect(screen.getByLabelText('LCP 达标率 92%')).toBeTruthy();
    render(<VitalsRing vitals={{ lcp: null, inp: null, cls: null, overall: null }} />);
    expect(screen.getAllByText(/无样本/).length).toBeGreaterThan(0);
  });

  it('TC-M02-007/013 状态横幅区分「更新失败（有时点）」与「首次失败（无时点）」', () => {
    const first = render(
      <StatusBanners phase="interrupted" everSucceeded appNotFound={false} lastSuccessAt="2026-09-18T14:26:00" />,
    );
    expect(screen.getByText(/最后成功统计时点/)).toBeTruthy();
    first.unmount();
    const second = render(<StatusBanners phase="interrupted" everSucceeded={false} appNotFound={false} />);
    expect(screen.getByText(/暂无已加载数据/)).toBeTruthy();
    second.unmount();
    render(<StatusBanners phase="live" everSucceeded appNotFound={false} />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('TC-M02-011 应用被删横幅', () => {
    render(<StatusBanners phase="interrupted" everSucceeded appNotFound lastSuccessAt="2026-09-18T14:26:00" />);
    expect(screen.getByText(/该应用不可用/)).toBeTruthy();
  });

  it('token 对账：design-system §7 的 34 行 token 全部落为 CSS 变量（组合行展开为 43 个变量）', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/realtime/theme.css'), 'utf-8');
    const required = [
      '--color-primary', '--color-primary-hover', '--color-primary-subtle', '--color-accent',
      '--color-bg', '--color-surface', '--color-surface-2', '--color-text', '--color-text-secondary',
      '--color-text-tertiary', '--color-border', '--color-success', '--color-success-subtle',
      '--color-warning', '--color-warning-subtle', '--color-danger', '--color-danger-subtle',
      '--color-info', '--color-info-subtle', '--font-number', '--font-h1', '--font-h2', '--font-h3',
      '--font-body', '--font-caption', '--font-family', '--space-1', '--space-2', '--space-3',
      '--space-4', '--space-5', '--space-6', '--space-7', '--space-8', '--radius-sm', '--radius-md',
      '--radius-lg', '--radius-full', '--shadow-md', '--shadow-lg', '--motion-fade', '--motion-curve',
      '--motion-hover',
    ];
    const missing = required.filter((name) => !source.includes(`${name}:`));
    expect(missing).toEqual([]);
  });

  it('快照载荷字段消费自洽（契约冒烟）', () => {
    const snapshot: RealtimeScreenSnapshot = makeSnapshotShaped();
    expect(snapshot.errors[0].fingerprint).toBeTruthy();
    expect(snapshot.alerts.unresolved[0].status).toBe('firing');
    expect(snapshot.trend).toHaveLength(60);
  });
});

function makeSnapshotShaped(): RealtimeScreenSnapshot {
  return {
    appKey: 'demo',
    generatedAt: '2026-09-18T14:32:00',
    generatedAtEpochMs: 0,
    statsWindow: { dayStartAt: '2026-09-18T00:00:00', windowMinutes: 60 },
    metrics: { pv: 1, uv: 1, errorCount: 0, errorRate: 0, score: 90, activeSessions: 1, apiSuccessRate: 1 },
    trend: Array.from({ length: 60 }, (_, index) => ({ minuteEpochMs: index, pv: null, errors: null })),
    errors: [{ fingerprint: 'fp', type: 'JS 错误', message: 'm', page: '/p', occurredAt: '2026-09-18T14:00:00' }],
    topLists: { slowApis: [], jsErrors: [], worstPages: [] },
    alerts: { unresolved: [alert], recent24h: [alert] },
    vitals: { lcp: null, inp: null, cls: null, overall: null },
    failure: { status: 'ok', categories: [] },
  };
}
