import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Row,
  Slider,
  Space,
  Spin,
  Table,
  Tag,
  Timeline,
  Typography,
  Segmented,
} from 'antd';
import { ArrowLeftOutlined, PauseCircleOutlined, PlayCircleOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { ReplayPlayer } from '@web-monitor/replay';
import type { ReplayRecord } from '@web-monitor/types';
import { fetchReplay, fetchSessionDetail } from '../api/endpoints';
import useRangeParams from '../hooks/useRangeParams';

const KIND_COLOR: Record<string, string> = {
  pv: 'blue',
  click: 'geekblue',
  route: 'purple',
  request: 'cyan',
  error: 'red',
  custom: 'default',
  console: 'orange',
  form: 'green',
};

export default function SessionDetail() {
  const { sessionId = '' } = useParams();
  const params = useRangeParams();
  const navigate = useNavigate();

  const { data: detail, isLoading } = useQuery({
    queryKey: ['session-detail', sessionId, params],
    queryFn: () => fetchSessionDetail(sessionId, params),
    enabled: !!sessionId && !!params.appKey,
  });

  const { data: replay, isLoading: replayLoading, error: replayError } = useQuery({
    queryKey: ['session-replay', sessionId, params],
    queryFn: () => fetchReplay(sessionId, params),
    enabled: !!sessionId && !!params.appKey && !!detail?.session.hasReplay,
    retry: false,
  });

  if (isLoading) return <div className="wm-page"><Spin /></div>;
  if (!detail) return <div className="wm-page"><Empty description="未找到该会话" /></div>;

  const { session, timeline, errors, metrics } = detail;

  return (
    <div className="wm-page">
      <div className="wm-page-header">
        <Space direction="vertical" size={4}>
          <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate('/sessions')}>
            返回会话列表
          </Button>
          <h2 className="wm-page-title" style={{ marginTop: 8 }}>
            会话 {session.sessionId}
          </h2>
          <p className="wm-page-subtitle">
            {session.userId ? `用户 ${session.userId} · ` : ''}
            开始于 {dayjs(session.startTime).format('YYYY-MM-DD HH:mm:ss')} · 时长{' '}
            {(session.duration / 1000).toFixed(1)}s
          </p>
        </Space>
      </div>

      <Row gutter={[12, 12]} className="wm-section">
        <Col span={24}>
          <Card size="small" title="会话概览">
            <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
              <Descriptions.Item label="匿名 ID">{session.anonymousId}</Descriptions.Item>
              <Descriptions.Item label="页面浏览">{metrics.pv}</Descriptions.Item>
              <Descriptions.Item label="错误数">
                {metrics.errorCount > 0 ? <Tag color="red">{metrics.errorCount}</Tag> : 0}
              </Descriptions.Item>
              <Descriptions.Item label="平均接口耗时">{metrics.avgApiDuration} ms</Descriptions.Item>
              <Descriptions.Item label="设备">
                {session.device} / {session.browser} / {session.os}
              </Descriptions.Item>
              <Descriptions.Item label="地域">{session.geo || '—'}</Descriptions.Item>
              <Descriptions.Item label="入口页">{session.entryUrl}</Descriptions.Item>
              <Descriptions.Item label="出口页">{session.exitUrl}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      {errors.length ? (
        <div className="wm-section">
          <Alert
            type="error"
            showIcon
            message={`该会话中出现 ${errors.length} 个错误分组`}
            description={
              <Space wrap>
                {errors.map((error) => (
                  <Link key={error.id} to={`/errors/${error.id}`}>
                    <Tag color="red">{error.message.slice(0, 60)}</Tag>
                  </Link>
                ))}
              </Space>
            }
          />
        </div>
      ) : null}

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={14}>
          {session.hasReplay ? (
            replayLoading ? (
              <Card size="small" title="操作回放"><Spin /></Card>
            ) : replayError || !replay ? (
              <Card size="small" title="操作回放">
                <Empty description="回放数据加载失败或已被清理（默认保留 30 天）" />
              </Card>
            ) : (
              <ReplayPanel events={replay.events} errorMarks={replay.errorMarks} videoWidth={replay.width} />
            )
          ) : (
            <Card size="small" title="操作回放">
              <Empty description="该会话未录制回放（受录制采样率与存储策略影响）" />
            </Card>
          )}
        </Col>
        <Col xs={24} xl={10}>
          <Card
            size="small"
            title="事件时间线"
            styles={{ body: { maxHeight: 640, overflow: 'auto' } }}
          >
            {timeline.length ? (
              <Timeline
                items={timeline.map((item) => ({
                  color:
                    item.level === 'error'
                      ? 'red'
                      : item.level === 'warning'
                        ? 'orange'
                        : KIND_COLOR[item.kind] || 'blue',
                  children: (
                    <div>
                      <div style={{ fontSize: 12, color: '#a8abb2' }}>
                        {dayjs(item.timestamp).format('HH:mm:ss.SSS')} ·{' '}
                        <Tag color={KIND_COLOR[item.kind] || 'default'} style={{ marginInlineEnd: 0 }}>
                          {item.kind}
                        </Tag>
                      </div>
                      <div style={{ marginTop: 2, color: item.level === 'error' ? '#cf1322' : '#1f2329' }}>
                        {item.title}
                      </div>
                      {item.detail ? (
                        <div style={{ fontSize: 12, color: '#8a9099', wordBreak: 'break-all' }}>
                          {item.detail}
                        </div>
                      ) : null}
                    </div>
                  ),
                }))}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无事件" />
            )}
          </Card>
        </Col>
      </Row>

      {errors.length ? (
        <div className="wm-section" style={{ marginTop: 16 }}>
          <Table
            size="small"
            rowKey="id"
            dataSource={errors}
            pagination={false}
            columns={[
              {
                title: '错误',
                dataIndex: 'message',
                render: (message: string, record) => (
                  <Link to={`/errors/${record.id}`}>{message}</Link>
                ),
              },
              { title: '类型', dataIndex: 'category', width: 140 },
              { title: '级别', dataIndex: 'level', width: 90 },
              { title: '状态', dataIndex: 'status', width: 100 },
            ]}
          />
        </div>
      ) : null}
    </div>
  );
}

/** 回放播放器：进度条 + 倍速 + 错误标记跳转 */
function ReplayPanel({
  events,
  errorMarks,
  videoWidth,
}: {
  events: ReplayRecord[];
  errorMarks: Array<{ timestamp: number; message: string; errorId: string }>;
  videoWidth: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<ReplayPlayer | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    if (!containerRef.current || !events.length) return;
    const player = new ReplayPlayer({
      target: containerRef.current,
      showMouseTrail: true,
      autoPlay: false,
    });
    playerRef.current = player;
    player.on('loaded', ({ duration: total }: { duration: number }) => setDuration(total));
    player.on('timeupdate', (time: number) => setCurrentTime(time));
    player.on('play', () => setPlaying(true));
    player.on('pause', () => setPlaying(false));
    player.on('finish', () => setPlaying(false));
    player.load(events, errorMarks);
    return () => {
      player.destroy();
      playerRef.current = null;
    };
  }, [events, errorMarks]);

  const startTime = useMemo(() => (events.length ? events[0].timestamp : 0), [events]);

  const jumpToError = (timestamp: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.seek(Math.max(timestamp - startTime - 2000, 0));
  };

  return (
    <Card size="small" title="操作回放">
      <div className="wm-replay-container" ref={containerRef} style={{ minHeight: Math.round(videoWidth * 0.4) }} />
      <div style={{ marginTop: 12 }}>
        <Space style={{ width: '100%' }} direction="vertical" size={4}>
          <Space style={{ width: '100%' }}>
            <Button
              type="text"
              icon={playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              onClick={() => playerRef.current?.toggle()}
            />
            <Slider
              style={{ width: 320, marginInline: 8 }}
              min={0}
              max={duration || 1}
              value={currentTime}
              tooltip={{ formatter: (value) => `${((value || 0) / 1000).toFixed(1)}s` }}
              onChange={(value) => {
                playerRef.current?.seek(value);
                setCurrentTime(value);
              }}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {(currentTime / 1000).toFixed(1)}s / {(duration / 1000).toFixed(1)}s
            </Typography.Text>
            <Segmented
              size="small"
              value={speed}
              onChange={(value) => {
                const next = Number(value);
                setSpeed(next);
                playerRef.current?.setSpeed(next);
              }}
              options={[0.5, 1, 2, 4].map((item) => ({ label: `${item}x`, value: item }))}
            />
          </Space>
          {errorMarks.length ? (
            <Space wrap>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                错误标记：
              </Typography.Text>
              {errorMarks.map((mark, index) => (
                <Tag
                  key={`${mark.timestamp}-${index}`}
                  color="red"
                  style={{ cursor: 'pointer' }}
                  onClick={() => jumpToError(mark.timestamp)}
                >
                  #{index + 1} {mark.message.slice(0, 40)}
                </Tag>
              ))}
            </Space>
          ) : null}
        </Space>
      </div>
    </Card>
  );
}
