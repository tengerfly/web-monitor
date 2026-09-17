import { useState } from 'react';
import { Input, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import type { UserProfileItem } from '@web-monitor/types';
import { fetchUsers } from '../api/endpoints';
import useRangeParams from '../hooks/useRangeParams';

export default function Users() {
  const params = useRangeParams();
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['users', params, keyword, page],
    queryFn: () => fetchUsers({ ...params, keyword: keyword || undefined, page, pageSize: 20 }),
    enabled: !!params.appKey,
  });

  return (
    <div className="wm-page">
      <div className="wm-page-header">
        <div>
          <h2 className="wm-page-title">用户细查</h2>
          <p className="wm-page-subtitle">按用户定位问题：查看其会话、错误与完整行为轨迹</p>
        </div>
      </div>

      <Space style={{ marginBottom: 12 }}>
        <Input.Search
          allowClear
          style={{ width: 320 }}
          placeholder="用户 ID / 匿名 ID"
          onSearch={(value) => {
            setKeyword(value);
            setPage(1);
          }}
        />
      </Space>

      <Table<UserProfileItem>
        size="small"
        rowKey="anonymousId"
        loading={isLoading}
        dataSource={data?.list || []}
        pagination={{
          current: page,
          pageSize: 20,
          total: data?.total || 0,
          onChange: setPage,
          showTotal: (total) => `共 ${total} 位用户`,
        }}
        columns={[
          {
            title: '用户标识',
            width: 220,
            render: (_: unknown, record) => (
              <div>
                <div>
                  {record.userId ? (
                    <Tag color="blue">{record.userId}</Tag>
                  ) : (
                    <Tag>匿名用户</Tag>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#a8abb2', fontFamily: 'monospace' }}>
                  {record.anonymousId}
                </div>
              </div>
            ),
          },
          {
            title: '首次访问',
            dataIndex: 'firstSeen',
            width: 170,
            render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm'),
          },
          {
            title: '最近访问',
            dataIndex: 'lastSeen',
            width: 170,
            render: (value: string) => dayjs(value).format('YYYY-MM-DD HH:mm'),
          },
          { title: '会话数', dataIndex: 'sessions', width: 90, align: 'right' },
          { title: 'PV', dataIndex: 'pv', width: 84, align: 'right' },
          {
            title: '错误数',
            dataIndex: 'errorCount',
            width: 90,
            align: 'right',
            render: (value: number) =>
              value > 0 ? <Tag color="red">{value}</Tag> : <span style={{ color: '#c9cdd4' }}>0</span>,
          },
          {
            title: '设备 / 浏览器',
            width: 200,
            render: (_: unknown, record) => (
              <span style={{ fontSize: 12, color: '#646a73' }}>
                {record.devices.join(', ') || '—'} / {record.browsers.join(', ') || '—'}
              </span>
            ),
          },
          { title: '地域', dataIndex: 'geo', width: 160, render: (value?: string) => value || '—' },
          {
            title: '操作',
            width: 160,
            render: (_: unknown, record) => (
              <Space>
                <Link
                  to={`/sessions?userId=${encodeURIComponent(record.userId || record.anonymousId)}`}
                  onClick={(event) => event.stopPropagation()}
                >
                  会话
                </Link>
                <a
                  onClick={(event) => {
                    event.stopPropagation();
                    navigate(`/behavior?userId=${encodeURIComponent(record.anonymousId)}`);
                  }}
                >
                  行为
                </a>
              </Space>
            ),
          },
        ]}
      />

      <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
        用户数据由 <code>identify(userId)</code> 与匿名 ID 共同标识。建议在用户登录后立即调用
        <code> monitor.identify(userId) </code>，即可把登录前后的行为串联到同一用户画像下。
      </Typography.Paragraph>
    </div>
  );
}
