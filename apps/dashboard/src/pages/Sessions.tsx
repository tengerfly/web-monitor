import { useState } from 'react';
import { Button, Input, Space, Table, Tag, Tooltip } from 'antd';
import { VideoCameraOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import dayjs from 'dayjs';
import type { SessionItem } from '@web-monitor/types';
import { fetchSessions } from '../api/endpoints';
import useRangeParams from '../hooks/useRangeParams';

export default function Sessions() {
  const [searchParams] = useSearchParams();
  const params = useRangeParams();
  const navigate = useNavigate();
  const [userId, setUserId] = useState(searchParams.get('userId') || '');
  const [sessionId, setSessionId] = useState(searchParams.get('sessionId') || '');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['sessions', params, userId, sessionId, page],
    queryFn: () =>
      fetchSessions({
        ...params,
        userId: userId || undefined,
        sessionId: sessionId || undefined,
        page,
        pageSize: 20,
      }),
    enabled: !!params.appKey,
  });

  return (
    <div className="wm-page">
      <div className="wm-page-header">
        <div>
          <h2 className="wm-page-title">会话与回放</h2>
          <p className="wm-page-subtitle">按用户或会话 ID 定位，查看完整事件时间线与操作回放</p>
        </div>
      </div>

      <Space style={{ marginBottom: 12 }} wrap>
        <Input.Search
          allowClear
          style={{ width: 280 }}
          placeholder="用户 ID / 匿名 ID"
          defaultValue={userId}
          onSearch={(value) => {
            setUserId(value);
            setPage(1);
          }}
        />
        <Input.Search
          allowClear
          style={{ width: 320 }}
          placeholder="会话 ID（s_xxx）"
          defaultValue={sessionId}
          onSearch={(value) => {
            setSessionId(value);
            setPage(1);
          }}
        />
      </Space>

      <Table<SessionItem>
        size="small"
        rowKey="sessionId"
        loading={isLoading}
        dataSource={data?.list || []}
        onRow={(record) => ({
          onClick: () => navigate(`/sessions/${record.sessionId}`),
          style: { cursor: 'pointer' },
        })}
        pagination={{
          current: page,
          pageSize: 20,
          total: data?.total || 0,
          onChange: setPage,
          showTotal: (total) => `共 ${total} 个会话`,
        }}
        columns={[
          {
            title: '用户',
            width: 180,
            render: (_: unknown, record) => (
              <div>
                <div>{record.userId || '匿名'}</div>
                <div style={{ fontSize: 12, color: '#a8abb2', fontFamily: 'monospace' }}>
                  {record.anonymousId}
                </div>
              </div>
            ),
          },
          {
            title: '开始时间',
            dataIndex: 'startTime',
            width: 170,
            render: (value: string) => dayjs(value).format('MM-DD HH:mm:ss'),
          },
          {
            title: '时长',
            dataIndex: 'duration',
            width: 100,
            align: 'right',
            render: (value: number) => `${(value / 1000).toFixed(1)} s`,
          },
          { title: '页面数', dataIndex: 'pageViews', width: 84, align: 'right' },
          {
            title: '入口页',
            dataIndex: 'entryUrl',
            ellipsis: true,
            render: (value: string) => <Tooltip title={value}>{value}</Tooltip>,
          },
          {
            title: '错误',
            dataIndex: 'errorCount',
            width: 84,
            align: 'right',
            render: (value: number) =>
              value > 0 ? <Tag color="red">{value}</Tag> : <span style={{ color: '#c9cdd4' }}>0</span>,
          },
          {
            title: '设备',
            width: 200,
            render: (_: unknown, record) => (
              <span style={{ fontSize: 12, color: '#646a73' }}>
                {record.device} / {record.browser} / {record.os}
              </span>
            ),
          },
          {
            title: '回放',
            dataIndex: 'hasReplay',
            width: 100,
            render: (value: boolean, record) =>
              value ? (
                <Link to={`/sessions/${record.sessionId}`} onClick={(event) => event.stopPropagation()}>
                  <Tag icon={<VideoCameraOutlined />} color="blue">
                    有回放
                  </Tag>
                </Link>
              ) : (
                <span style={{ color: '#c9cdd4', fontSize: 12 }}>无</span>
              ),
          },
        ]}
      />
      <div style={{ marginTop: 8, fontSize: 12, color: '#8a9099' }}>
        提示：回放数据按采样率录制（默认 10%），未录制的会话仍可查看完整事件时间线。
        <Button type="link" size="small" onClick={() => (window.location.href = '/connect')}>
          了解录制配置
        </Button>
      </div>
    </div>
  );
}
