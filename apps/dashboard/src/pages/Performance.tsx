import { useState } from 'react';
import { Card, Col, Row, Segmented, Table, Tag, Tabs, Empty } from 'antd';
import { useQuery } from '@tanstack/react-query';
import {
  fetchApis,
  fetchDimensions,
  fetchPerformanceSummary,
  fetchPerformanceTrend,
  fetchResources,
  fetchRoutes,
} from '../api/endpoints';
import StatCard from '../components/StatCard';
import TrendChart from '../components/TrendChart';
import useRangeParams from '../hooks/useRangeParams';

const VITAL_TIPS: Record<string, string> = {
  LCP: '最大内容绘制：理想 ≤ 2.5s，需要改进 ≤ 4s',
  INP: '交互到下一次绘制：理想 ≤ 200ms，需要改进 ≤ 500ms',
  CLS: '累计布局偏移：理想 ≤ 0.1，需要改进 ≤ 0.25',
  FCP: '首次内容绘制：理想 ≤ 1.8s',
  TTFB: '首字节时间：理想 ≤ 800ms',
  FID: '首次输入延迟（旧指标）：理想 ≤ 100ms',
  FMP: '首次有意义绘制（近似值）',
  TTI: '可交互时间（近似值）',
};

function ratingOf(metric: string, value: number): { color: string; text: string } {
  const thresholds: Record<string, [number, number]> = {
    LCP: [2500, 4000],
    INP: [200, 500],
    CLS: [0.1, 0.25],
    FCP: [1800, 3000],
    TTFB: [800, 1800],
    FID: [100, 300],
  };
  const config = thresholds[metric];
  if (!config) return { color: 'default', text: '—' };
  if (value <= config[0]) return { color: 'green', text: '良好' };
  if (value <= config[1]) return { color: 'orange', text: '需改进' };
  return { color: 'red', text: '较差' };
}

export default function Performance() {
  const params = useRangeParams();
  const [trendMetric, setTrendMetric] = useState<'web-vital' | 'api' | 'navigation'>('web-vital');

  const { data: summary, isLoading } = useQuery({
    queryKey: ['perf-summary', params],
    queryFn: () => fetchPerformanceSummary(params),
    enabled: !!params.appKey,
  });

  const { data: trend, isLoading: trendLoading } = useQuery({
    queryKey: ['perf-trend', params, trendMetric],
    queryFn: () => fetchPerformanceTrend({ ...params, category: trendMetric }),
    enabled: !!params.appKey,
  });

  const { data: resources } = useQuery({
    queryKey: ['perf-resources', params],
    queryFn: () => fetchResources({ ...params, limit: 20 }),
    enabled: !!params.appKey,
  });

  const { data: apis } = useQuery({
    queryKey: ['perf-apis', params],
    queryFn: () => fetchApis({ ...params, limit: 20 }),
    enabled: !!params.appKey,
  });

  const { data: routes } = useQuery({
    queryKey: ['perf-routes', params],
    queryFn: () => fetchRoutes({ ...params, limit: 20 }),
    enabled: !!params.appKey,
  });

  const navigation = summary?.navigation;

  return (
    <div className="wm-page">
      <div className="wm-page-header">
        <div>
          <h2 className="wm-page-title">性能分析</h2>
          <p className="wm-page-subtitle">Core Web Vitals、加载阶段拆解、资源与接口耗时</p>
        </div>
      </div>

      <Row gutter={[12, 12]} className="wm-section">
        {(summary?.vitals || []).map((item) => {
          const rating = ratingOf(item.metric, item.p75);
          return (
            <Col xs={12} md={8} xl={4} key={item.metric}>
              <Card size="small" styles={{ body: { padding: 16 } }}>
                <div className="wm-stat-label">
                  {item.metric} <Tag color={rating.color} style={{ marginLeft: 4 }}>{rating.text}</Tag>
                </div>
                <div style={{ marginTop: 6 }}>
                  <span className="wm-stat-value">
                    {item.metric === 'CLS' ? item.p75.toFixed(3) : Math.round(item.p75)}
                  </span>
                  <span className="wm-stat-unit">{item.metric === 'CLS' ? '' : 'ms'} (P75)</span>
                </div>
                <div style={{ fontSize: 12, color: '#8a9099', marginTop: 6 }}>
                  样本 {item.samples} · P95 {item.metric === 'CLS' ? item.p95.toFixed(3) : Math.round(item.p95)}
                  {item.metric === 'CLS' ? '' : 'ms'} · 达标率 {(item.passRate * 100).toFixed(1)}%
                </div>
                {VITAL_TIPS[item.metric] ? (
                  <div style={{ fontSize: 12, color: '#a8abb2', marginTop: 4 }}>{VITAL_TIPS[item.metric]}</div>
                ) : null}
              </Card>
            </Col>
          );
        })}
        {!summary?.vitals?.length ? (
          <Col span={24}>
            <Card size="small">
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前时间范围内暂无性能数据" />
            </Card>
          </Col>
        ) : null}
      </Row>

      <Row gutter={[12, 12]} className="wm-section">
        <Col xs={12} md={6} xl={3}>
          <StatCard label="DNS 解析" value={navigation?.avgDns} unit="ms" loading={isLoading} inverse />
        </Col>
        <Col xs={12} md={6} xl={3}>
          <StatCard label="TCP 连接" value={navigation?.avgTcp} unit="ms" loading={isLoading} inverse />
        </Col>
        <Col xs={12} md={6} xl={3}>
          <StatCard label="TLS 握手" value={navigation?.avgTls} unit="ms" loading={isLoading} inverse />
        </Col>
        <Col xs={12} md={6} xl={3}>
          <StatCard label="请求耗时" value={navigation?.avgRequest} unit="ms" loading={isLoading} inverse />
        </Col>
        <Col xs={12} md={6} xl={3}>
          <StatCard label="响应耗时" value={navigation?.avgResponse} unit="ms" loading={isLoading} inverse />
        </Col>
        <Col xs={12} md={6} xl={3}>
          <StatCard label="DOM 解析" value={navigation?.avgDomParse} unit="ms" loading={isLoading} inverse />
        </Col>
        <Col xs={12} md={6} xl={3}>
          <StatCard label="长任务数/页" value={summary?.longTask.avgCount} precision={2} loading={isLoading} inverse />
        </Col>
        <Col xs={12} md={6} xl={3}>
          <StatCard label="平均 FPS" value={summary?.longTask.avgFps} precision={1} loading={isLoading} />
        </Col>
      </Row>

      <div className="wm-section">
        <TrendChart
          title="性能指标趋势"
          loading={trendLoading}
          data={trend?.list}
          series={(trend?.metrics || [])
            .slice(0, 5)
            .map((metric) => ({ key: metric, name: `${metric} 均值` }))}
          extra={
            <Segmented
              size="small"
              value={trendMetric}
              onChange={(value) => setTrendMetric(value as typeof trendMetric)}
              options={[
                { label: 'Web Vitals', value: 'web-vital' },
                { label: '接口耗时', value: 'api' },
                { label: '页面加载', value: 'navigation' },
              ]}
            />
          }
          height={320}
        />
      </div>

      <Tabs
        items={[
          {
            key: 'apis',
            label: '慢接口 Top 20',
            children: (
              <Table
                size="small"
                rowKey={(record) => `${record.method}-${record.url}`}
                dataSource={apis || []}
                pagination={false}
                scroll={{ x: 900 }}
                columns={[
                  { title: '方法', dataIndex: 'method', width: 80 },
                  { title: '接口', dataIndex: 'url', ellipsis: true },
                  { title: '请求数', dataIndex: 'count', width: 90, align: 'right' },
                  { title: '平均耗时', dataIndex: 'avgDuration', width: 110, align: 'right', render: (v: number) => `${v} ms` },
                  { title: 'P95', dataIndex: 'p95', width: 100, align: 'right', render: (v: number) => `${v} ms` },
                  { title: 'P99', dataIndex: 'p99', width: 100, align: 'right', render: (v: number) => `${v} ms` },
                  {
                    title: '成功率',
                    dataIndex: 'successRate',
                    width: 100,
                    align: 'right',
                    render: (v: number) => (
                      <Tag color={v >= 0.99 ? 'green' : v >= 0.95 ? 'orange' : 'red'}>
                        {(v * 100).toFixed(2)}%
                      </Tag>
                    ),
                  },
                  {
                    title: '状态码分布',
                    dataIndex: 'statusCodes',
                    width: 220,
                    render: (codes: Record<string, number>) =>
                      Object.entries(codes || {})
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, 4)
                        .map(([code, count]) => (
                          <Tag key={code} color={Number(code) >= 400 ? 'red' : 'default'}>
                            {code}×{count}
                          </Tag>
                        )),
                  },
                ]}
              />
            ),
          },
          {
            key: 'resources',
            label: '慢资源 Top 20',
            children: (
              <Table
                size="small"
                rowKey={(record) => `${record.name}-${record.initiatorType}`}
                dataSource={resources || []}
                pagination={false}
                scroll={{ x: 800 }}
                columns={[
                  { title: '资源', dataIndex: 'name', ellipsis: true },
                  { title: '类型', dataIndex: 'initiatorType', width: 100 },
                  { title: '次数', dataIndex: 'count', width: 90, align: 'right' },
                  { title: '平均耗时', dataIndex: 'avgDuration', width: 110, align: 'right', render: (v: number) => `${v} ms` },
                  { title: 'P95', dataIndex: 'p95', width: 100, align: 'right', render: (v: number) => `${v} ms` },
                  {
                    title: '平均体积',
                    dataIndex: 'avgSize',
                    width: 120,
                    align: 'right',
                    render: (v: number) => `${(v / 1024).toFixed(1)} KB`,
                  },
                ]}
              />
            ),
          },
          {
            key: 'routes',
            label: '慢路由 Top 20',
            children: (
              <Table
                size="small"
                rowKey="path"
                dataSource={routes || []}
                pagination={false}
                columns={[
                  { title: '路由', dataIndex: 'path', ellipsis: true },
                  { title: '切换次数', dataIndex: 'count', width: 110, align: 'right' },
                  { title: '平均耗时', dataIndex: 'avgDuration', width: 120, align: 'right', render: (v: number) => `${v} ms` },
                  { title: 'P95', dataIndex: 'p95', width: 110, align: 'right', render: (v: number) => `${v} ms` },
                ]}
              />
            ),
          },
          {
            key: 'dimensions',
            label: '维度分布',
            children: <DimensionPanel params={params} />,
          },
        ]}
      />
    </div>
  );
}

function DimensionPanel({ params }: { params: ReturnType<typeof useRangeParams> }) {
  const [dimension, setDimension] = useState('device');
  const { data } = useQuery({
    queryKey: ['perf-dimensions', params, dimension],
    queryFn: () => fetchDimensions({ ...params, dimension, metric: 'pageLoad' }),
    enabled: !!params.appKey,
  });

  return (
    <div>
      <Segmented
        style={{ marginBottom: 12 }}
        value={dimension}
        onChange={(value) => setDimension(String(value))}
        options={[
          { label: '设备类型', value: 'device' },
          { label: '浏览器', value: 'browser' },
          { label: '操作系统', value: 'os' },
          { label: '国家', value: 'country' },
          { label: '版本', value: 'version' },
        ]}
      />
      <Table
        size="small"
        rowKey="label"
        dataSource={data || []}
        pagination={false}
        columns={[
          { title: '维度值', dataIndex: 'label' },
          { title: '样本数', dataIndex: 'count', width: 120, align: 'right' },
          { title: '平均加载耗时', dataIndex: 'avgValue', width: 160, align: 'right', render: (v: number) => `${v} ms` },
          { title: 'P95', dataIndex: 'p95', width: 120, align: 'right', render: (v: number) => `${v} ms` },
        ]}
      />
    </div>
  );
}
