import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import { ArrowLeftOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import type { Breadcrumb, ErrorDetailEvent, StackFrame } from '@web-monitor/types';
import { fetchErrorDetail, updateErrorStatus } from '../api/endpoints';
import TrendChart from '../components/TrendChart';
import useRangeParams from '../hooks/useRangeParams';

const LEVEL_COLOR: Record<string, string> = {
  fatal: 'red',
  error: 'volcano',
  warning: 'orange',
  info: 'blue',
};

const BREADCRUMB_COLOR: Record<string, string> = {
  click: 'blue',
  route: 'purple',
  request: 'geekblue',
  console: 'default',
  input: 'cyan',
  error: 'red',
};

export default function ErrorDetail() {
  const { id = '' } = useParams();
  const params = useRangeParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [eventPage, setEventPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['error-detail', id, params, eventPage],
    queryFn: () => fetchErrorDetail(id, { ...params, page: eventPage, pageSize: 10 }),
    enabled: !!id && !!params.appKey,
  });

  if (isLoading) return <div className="wm-page"><Spin /></div>;
  if (!data) return <div className="wm-page"><Empty description="未找到该错误分组" /></div>;

  const { group, frames, distribution } = data;

  return (
    <div className="wm-page">
      <div className="wm-page-header">
        <Space direction="vertical" size={4}>
          <Space>
            <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate('/errors')}>
              返回
            </Button>
            <Tag color={LEVEL_COLOR[group.level] || 'default'}>{group.level}</Tag>
            <Tag>{group.category}</Tag>
          </Space>
          <h2 className="wm-page-title" style={{ marginTop: 8 }}>
            {group.message}
          </h2>
          <p className="wm-page-subtitle">
            指纹 {group.fingerprint} · 首次出现 {dayjs(group.firstSeen).format('YYYY-MM-DD HH:mm:ss')} ·
            最近出现 {dayjs(group.lastSeen).format('YYYY-MM-DD HH:mm:ss')}
          </p>
        </Space>
        <Space>
          <Select
            value={group.status}
            style={{ width: 130 }}
            onChange={async (value) => {
              await updateErrorStatus(group.id, { status: value });
              void queryClient.invalidateQueries({ queryKey: ['error-detail'] });
            }}
            options={[
              { value: 'pending', label: '待处理' },
              { value: 'resolved', label: '已修复' },
              { value: 'ignored', label: '已忽略' },
            ]}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['error-detail'] })}
          >
            刷新
          </Button>
        </Space>
      </div>

      <Row gutter={[12, 12]} className="wm-section">
        <Col xs={12} md={6}>
          <Card size="small">
            <div className="wm-stat-label">出现次数</div>
            <div className="wm-stat-value">{group.count}</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <div className="wm-stat-label">影响用户</div>
            <div className="wm-stat-value">{group.affectedUsers}</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <div className="wm-stat-label">影响会话</div>
            <div className="wm-stat-value">{group.affectedSessions}</div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <div className="wm-stat-label">涉及版本</div>
            <div style={{ marginTop: 6 }}>
              {group.appVersions.length
                ? group.appVersions.map((version) => <Tag key={version}>v{version}</Tag>)
                : '—'}
            </div>
          </Card>
        </Col>
      </Row>

      <div className="wm-section">
        <TrendChart
          title="出现趋势"
          data={data.trend}
          series={[{ key: 'count', name: '出现次数', color: '#f5222d', area: true }]}
          height={220}
        />
      </div>

      <Tabs
        items={[
          {
            key: 'stack',
            label: '堆栈与源码',
            children: <StackPanel frames={frames} rawStack={data.rawStack} />,
          },
          {
            key: 'events',
            label: `最近事件（${data.events.total}）`,
            children: (
              <Table<ErrorDetailEvent>
                size="small"
                rowKey="id"
                dataSource={data.events.list}
                expandable={{
                  expandedRowRender: (record) => <EventContextPanel event={record} />,
                }}
                pagination={{
                  current: eventPage,
                  pageSize: 10,
                  total: data.events.total,
                  onChange: setEventPage,
                }}
                columns={[
                  {
                    title: '发生时间',
                    dataIndex: 'timestamp',
                    width: 180,
                    render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm:ss.SSS'),
                  },
                  {
                    title: '用户',
                    width: 200,
                    render: (_: unknown, record) => (
                      <Link to={`/sessions/${record.sessionId}`}>
                        {record.userId || record.anonymousId}
                      </Link>
                    ),
                  },
                  { title: '页面', dataIndex: 'pageId', ellipsis: true },
                  { title: '版本', dataIndex: 'appVersion', width: 90 },
                  { title: '环境', dataIndex: 'env', width: 100 },
                  {
                    title: '设备',
                    width: 200,
                    render: (_: unknown, record) => `${record.devices} / ${record.browsers} / ${record.os}`,
                  },
                  {
                    title: '操作',
                    width: 120,
                    render: (_: unknown, record) => (
                      <Link to={`/sessions/${record.sessionId}`} state={{ replay: true }}>
                        查看回放
                      </Link>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'trail',
            label: '行为轨迹',
            children: <TrailPanel events={data.events.list} />,
          },
          {
            key: 'distribution',
            label: '影响面分布',
            children: (
              <Row gutter={[12, 12]}>
                {(
                  [
                    ['页面', distribution.byPage],
                    ['浏览器', distribution.byBrowser],
                    ['操作系统', distribution.byOs],
                    ['设备类型', distribution.byDevice],
                    ['版本', distribution.byVersion],
                  ] as const
                ).map(([title, list]) => (
                  <Col xs={24} md={12} xl={8} key={title}>
                    <Card size="small" title={title}>
                      {list.length ? (
                        list.slice(0, 10).map((item) => (
                          <div
                            key={item.label}
                            style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}
                          >
                            <span style={{ color: '#4e5969' }}>{item.label || 'unknown'}</span>
                            <span style={{ color: '#8a9099' }}>{item.count}</span>
                          </div>
                        ))
                      ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无数据" />
                      )}
                    </Card>
                  </Col>
                ))}
              </Row>
            ),
          },
        ]}
      />
    </div>
  );
}

/** 堆栈 + SourceMap 还原后的源码上下文 */
function StackPanel({ frames, rawStack }: { frames: StackFrame[]; rawStack?: string }) {
  if (!frames.length) {
    return (
      <Alert
        type="warning"
        showIcon
        message="未获取到堆栈信息"
        description="跨域脚本错误需要在 script 标签上添加 crossorigin 属性，并在 CDN 返回 CORS 响应头，否则浏览器只会给出 Script error."
      />
    );
  }
  const resolved = frames.some((frame) => frame.resolved);

  return (
    <Card
      size="small"
      title={resolved ? '已通过 SourceMap 还原到源码' : '未匹配到 SourceMap，展示压缩后位置'}
      extra={
        resolved ? null : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            请上传对应版本的 .map 文件以获得源码级定位
          </Typography.Text>
        )
      }
    >
      {frames.map((frame, index) => (
        <div key={index} style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 13, color: '#4e5969', marginBottom: 6 }}>
            <Tag color={frame.resolved ? 'green' : 'default'}>
              {frame.function || 'anonymous'}
            </Tag>
            {frame.filename}
            {frame.lineno ? `:${frame.lineno}:${frame.colno ?? 0}` : ''}
          </div>
          {frame.context?.length ? (
            <div className="wm-code-block">
              {frame.context.map((line, lineIndex) => {
                const startLine = (frame.lineno || 1) - Math.min(5, (frame.lineno || 1) - 1);
                const currentLine = startLine + lineIndex;
                const isError = currentLine === frame.lineno;
                return (
                  <div
                    className={`wm-code-line${isError ? ' wm-code-line-error' : ''}`}
                    key={lineIndex}
                  >
                    <span className="wm-line-number">{currentLine}</span>
                    <span>{line || ' '}</span>
                  </div>
                );
              })}
            </div>
          ) : frame.raw ? (
            <div className="wm-code-block">{frame.raw}</div>
          ) : null}
        </div>
      ))}
      {rawStack ? (
        <details style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', color: '#8a9099', fontSize: 12 }}>查看原始堆栈</summary>
          <div className="wm-code-block" style={{ marginTop: 8 }}>
            {rawStack}
          </div>
        </details>
      ) : null}
    </Card>
  );
}

/** 单条错误事件的现场快照 */
function EventContextPanel({ event }: { event: ErrorDetailEvent }) {
  const snapshot = event.snapshot;
  return (
    <Row gutter={[12, 12]}>
      <Col xs={24} xl={12}>
        <Card size="small" title="现场快照">
          <Descriptions size="small" column={2}>
            <Descriptions.Item label="页面">{snapshot?.route || event.pageId}</Descriptions.Item>
            <Descriptions.Item label="页面标题">{snapshot?.title || '—'}</Descriptions.Item>
            <Descriptions.Item label="可见性">{snapshot?.visibility || '—'}</Descriptions.Item>
            <Descriptions.Item label="视口">{snapshot?.viewport || '—'}</Descriptions.Item>
            <Descriptions.Item label="网络">
              {snapshot?.network
                ? `${snapshot.network.effectiveType || snapshot.network.type || '—'}${
                    snapshot.network.rtt ? ` / RTT ${snapshot.network.rtt}ms` : ''
                  }`
                : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="内存">
              {snapshot?.memory
                ? `${(snapshot.memory.usedJSHeapSize / 1024 / 1024).toFixed(1)}MB（${
                    (snapshot.memory.usage * 100).toFixed(1)
                  }%）`
                : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="最近请求" span={2}>
              {snapshot?.lastRequest
                ? `${snapshot.lastRequest.method} ${snapshot.lastRequest.url} → ${snapshot.lastRequest.status} (${Math.round(
                    snapshot.lastRequest.duration,
                  )}ms)`
                : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="最近成功请求" span={2}>
              {snapshot?.lastSuccessRequest
                ? `${snapshot.lastSuccessRequest.method} ${snapshot.lastSuccessRequest.url} → ${snapshot.lastSuccessRequest.status}`
                : '—'}
            </Descriptions.Item>
            <Descriptions.Item label="失败请求数">
              {snapshot?.failedRequestCount ?? '—'}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      </Col>
      <Col xs={24} xl={12}>
        <BreadcrumbPanel breadcrumbs={event.breadcrumbs} title="错误发生前的操作轨迹" />
      </Col>
    </Row>
  );
}

function BreadcrumbPanel({ breadcrumbs, title }: { breadcrumbs: Breadcrumb[]; title: string }) {
  return (
    <Card size="small" title={title} styles={{ body: { maxHeight: 320, overflow: 'auto' } }}>
      {breadcrumbs.length ? (
        breadcrumbs.map((item) => (
          <div className="wm-breadcrumb-row" key={item.id}>
            <span className="wm-breadcrumb-time">
              {dayjs(item.timestamp).format('HH:mm:ss.SSS')}
            </span>
            <Tag color={BREADCRUMB_COLOR[item.type] || 'default'} style={{ marginInlineEnd: 0 }}>
              {item.type}
            </Tag>
            <span style={{ flex: 1, wordBreak: 'break-all' }}>{item.message}</span>
          </div>
        ))
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无行为轨迹" />
      )}
    </Card>
  );
}

/** 聚合最近若干次错误的轨迹，便于发现「共性动作」 */
function TrailPanel({ events }: { events: ErrorDetailEvent[] }) {
  const [selected, setSelected] = useState(0);
  if (!events.length) return <Empty description="暂无事件" />;
  return (
    <div>
      <Segmented
        style={{ marginBottom: 12 }}
        value={selected}
        onChange={(value) => setSelected(Number(value))}
        options={events.map((event, index) => ({
          label: dayjs(event.timestamp).format('MM-DD HH:mm:ss'),
          value: index,
        }))}
      />
      <BreadcrumbPanel
        breadcrumbs={events[selected]?.breadcrumbs || []}
        title={`第 ${selected + 1} 次报错的用户操作轨迹`}
      />
    </div>
  );
}
