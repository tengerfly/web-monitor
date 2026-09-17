import { useState } from 'react';
import { Button, Card, Col, Empty, Input, Row, Select, Space, Table, Tabs, Tag, Form } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import ReactECharts from 'echarts-for-react';
import type { FunnelStep } from '@web-monitor/types';
import {
  fetchBehaviorEvents,
  fetchBehaviorPages,
  fetchBehaviorPaths,
  fetchBehaviorTrend,
  fetchFunnel,
  fetchHeatmap,
} from '../api/endpoints';
import TrendChart from '../components/TrendChart';
import useRangeParams from '../hooks/useRangeParams';

export default function Behavior() {
  const params = useRangeParams();

  const { data: trend } = useQuery({
    queryKey: ['behavior-trend', params],
    queryFn: () => fetchBehaviorTrend(params),
    enabled: !!params.appKey,
  });

  const { data: pages, isLoading: pagesLoading } = useQuery({
    queryKey: ['behavior-pages', params],
    queryFn: () => fetchBehaviorPages({ ...params, limit: 50 }),
    enabled: !!params.appKey,
  });

  return (
    <div className="wm-page">
      <div className="wm-page-header">
        <div>
          <h2 className="wm-page-title">用户行为</h2>
          <p className="wm-page-subtitle">PV/UV、页面排行、用户路径、漏斗与热力图</p>
        </div>
      </div>

      <div className="wm-section">
        <TrendChart
          title="行为趋势"
          data={trend}
          series={[
            { key: 'pv', name: 'PV', area: true },
            { key: 'uv', name: 'UV' },
            { key: 'clicks', name: '点击数', yAxisIndex: 1, area: false },
            { key: 'customs', name: '自定义埋点', yAxisIndex: 1, area: false, color: '#52c41a' },
          ]}
          height={280}
        />
      </div>

      <Tabs
        items={[
          {
            key: 'pages',
            label: '页面排行',
            children: (
              <Table
                size="small"
                rowKey="path"
                loading={pagesLoading}
                dataSource={pages || []}
                pagination={{ pageSize: 20, hideOnSinglePage: true }}
                columns={[
                  { title: '页面', dataIndex: 'path', ellipsis: true },
                  { title: 'PV', dataIndex: 'pv', width: 100, align: 'right' },
                  { title: 'UV', dataIndex: 'uv', width: 100, align: 'right' },
                  {
                    title: '平均停留',
                    dataIndex: 'avgDuration',
                    width: 110,
                    align: 'right',
                    render: (value: number) => `${(value / 1000).toFixed(1)} s`,
                  },
                  {
                    title: '平均滚动深度',
                    dataIndex: 'avgScrollDepth',
                    width: 130,
                    align: 'right',
                    render: (value: number) => `${value}%`,
                  },
                  {
                    title: '退出率',
                    dataIndex: 'exitRate',
                    width: 100,
                    align: 'right',
                    render: (value: number) => `${(value * 100).toFixed(1)}%`,
                  },
                ]}
              />
            ),
          },
          {
            key: 'paths',
            label: '用户路径',
            children: <PathsPanel />,
          },
          {
            key: 'funnel',
            label: '漏斗分析',
            children: <FunnelPanel />,
          },
          {
            key: 'heatmap',
            label: '点击热力图',
            children: <HeatmapPanel />,
          },
          {
            key: 'events',
            label: '事件明细',
            children: <EventsPanel />,
          },
        ]}
      />
    </div>
  );
}

function PathsPanel() {
  const params = useRangeParams();
  const { data, isLoading } = useQuery({
    queryKey: ['behavior-paths', params],
    queryFn: () => fetchBehaviorPaths({ ...params, limit: 3000 }),
    enabled: !!params.appKey,
  });

  if (!data?.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前时间范围内暂无路径数据" />;

  return (
    <Table
      size="small"
      rowKey="path"
      loading={isLoading}
      dataSource={data}
      pagination={{ pageSize: 20, hideOnSinglePage: true }}
      columns={[
        { title: '页面路径序列', dataIndex: 'path', ellipsis: true },
        { title: '会话数', dataIndex: 'count', width: 120, align: 'right' },
      ]}
    />
  );
}

function FunnelPanel() {
  const params = useRangeParams();
  const [steps, setSteps] = useState<FunnelStep[]>([
    { name: '进入首页', match: { type: 'page', value: '/' }, count: 0, rate: 0 },
    { name: '进入详情', match: { type: 'page', value: '/detail' }, count: 0, rate: 0 },
  ]);
  const [submitted, setSubmitted] = useState(false);

  const { data, isFetching } = useQuery({
    queryKey: ['behavior-funnel', params, JSON.stringify(steps)],
    queryFn: () => fetchFunnel(params, steps),
    enabled: !!params.appKey && submitted && steps.length > 0,
  });

  return (
    <div>
      {steps.map((step, index) => (
        <Space key={index} style={{ marginBottom: 8, display: 'flex' }} align="baseline">
          <span style={{ width: 64, color: '#8a9099', fontSize: 12 }}>第 {index + 1} 步</span>
          <Input
            style={{ width: 180 }}
            value={step.name}
            placeholder="步骤名称"
            onChange={(event) => {
              const next = [...steps];
              next[index] = { ...step, name: event.target.value };
              setSteps(next);
            }}
          />
          <Select
            style={{ width: 130 }}
            value={step.match.type}
            onChange={(value) => {
              const next = [...steps];
              next[index] = { ...step, match: { ...step.match, type: value } };
              setSteps(next);
            }}
            options={[
              { value: 'page', label: '页面访问' },
              { value: 'event', label: '事件埋点' },
            ]}
          />
          <Input
            style={{ width: 220 }}
            value={step.match.value}
            placeholder={step.match.type === 'page' ? '页面路径，如 /order' : '事件名或点击选择器'}
            onChange={(event) => {
              const next = [...steps];
              next[index] = { ...step, match: { ...step.match, value: event.target.value } };
              setSteps(next);
            }}
          />
          <Button
            type="text"
            icon={<MinusCircleOutlined />}
            disabled={steps.length <= 2}
            onClick={() => setSteps(steps.filter((_, i) => i !== index))}
          />
        </Space>
      ))}
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<PlusOutlined />} onClick={() => setSteps([...steps, { name: '', match: { type: 'page', value: '' }, count: 0, rate: 0 }])}>
          添加步骤
        </Button>
        <Button type="primary" loading={isFetching} onClick={() => setSubmitted(true)}>
          计算漏斗
        </Button>
      </Space>

      {data?.steps?.length ? (
        <Row gutter={[12, 12]}>
          {data.steps.map((step, index) => (
            <Col xs={24} md={12} xl={6} key={index}>
              <Card size="small">
                <div className="wm-stat-label">
                  {index + 1}. {step.name || step.match.value}
                </div>
                <div className="wm-stat-value">{step.count}</div>
                <div style={{ fontSize: 12, color: '#8a9099' }}>
                  转化率 {(step.rate * 100).toFixed(1)}%
                  {index > 0
                    ? ` · 流失 ${(
                        (1 - step.count / Math.max(data.steps[index - 1].count, 1)) *
                        100
                      ).toFixed(1)}%`
                    : ''}
                </div>
              </Card>
            </Col>
          ))}
        </Row>
      ) : null}
    </div>
  );
}

function HeatmapPanel() {
  const params = useRangeParams();
  const [pageId, setPageId] = useState('/');
  const { data } = useQuery({
    queryKey: ['behavior-heatmap', params, pageId],
    queryFn: () => fetchHeatmap({ ...params, pageId }),
    enabled: !!params.appKey && !!pageId,
  });

  const option = {
    grid: { left: 60, right: 30, top: 30, bottom: 50 },
    tooltip: {
      formatter: (info: any) =>
        `坐标 (${info.data[0]}, ${info.data[1]})<br/>点击 ${info.data[2]} 次`,
    },
    xAxis: { type: 'value', name: 'pageX', axisLabel: { color: '#8a9099' }, splitLine: { lineStyle: { color: '#f0f1f2' } } },
    yAxis: {
      type: 'value',
      name: 'pageY',
      inverse: true,
      axisLabel: { color: '#8a9099' },
      splitLine: { lineStyle: { color: '#f0f1f2' } },
    },
    series: [
      {
        type: 'scatter',
        symbolSize: (value: number[]) => Math.min(Math.sqrt(value[2]) * 4 + 6, 48),
        itemStyle: { color: 'rgba(245, 34, 45, 0.45)', borderColor: 'rgba(245,34,45,0.9)' },
        data: (data || []).map((point) => [point.x, point.y, point.count]),
      },
    ],
  };

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Input
          style={{ width: 320 }}
          value={pageId}
          onChange={(event) => setPageId(event.target.value)}
          placeholder="页面路径，如 /order/detail"
        />
      </Space>
      {data?.length ? (
        <ReactECharts option={option} style={{ height: 480 }} notMerge />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该页面暂无点击数据" />
      )}
    </div>
  );
}

function EventsPanel() {
  const params = useRangeParams();
  const [category, setCategory] = useState<string | undefined>();
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['behavior-events', params, category, keyword, page],
    queryFn: () =>
      fetchBehaviorEvents({
        ...params,
        category,
        keyword: keyword || undefined,
        page,
        pageSize: 30,
      }),
    enabled: !!params.appKey,
  });

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Select
          allowClear
          placeholder="事件类型"
          style={{ width: 160 }}
          value={category}
          onChange={setCategory}
          options={[
            'pv',
            'click',
            'route-change',
            'exposure',
            'scroll',
            'form',
            'console',
            'stay',
            'custom',
          ].map((item) => ({ value: item, label: item }))}
        />
        <Input.Search
          allowClear
          style={{ width: 300 }}
          placeholder="搜索事件名 / 属性"
          onSearch={(value) => {
            setKeyword(value);
            setPage(1);
          }}
        />
      </Space>
      <Table
        size="small"
        rowKey="id"
        loading={isLoading}
        dataSource={data?.list || []}
        pagination={{
          current: page,
          pageSize: 30,
          total: data?.total || 0,
          onChange: setPage,
          showTotal: (total) => `共 ${total} 条`,
        }}
        columns={[
          { title: '时间', dataIndex: 'timestamp', width: 180, render: (v: string) => v.slice(0, 23) },
          { title: '类型', dataIndex: 'category', width: 110, render: (v: string) => <Tag>{v}</Tag> },
          { title: '摘要', dataIndex: 'summary', ellipsis: true },
          { title: '页面', dataIndex: 'pageId', width: 180, ellipsis: true },
          {
            title: '用户',
            dataIndex: 'anonymousId',
            width: 160,
            render: (v: string) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{v}</span>,
          },
        ]}
      />
    </div>
  );
}

export { Form };
