import { useState } from 'react';
import { Input, Select, Space, Table, Tag, Tooltip, Typography, Button, Segmented } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import type { ErrorGroupItem } from '@web-monitor/types';
import { fetchErrorTrend, fetchErrors, updateErrorStatus } from '../api/endpoints';
import TrendChart from '../components/TrendChart';
import useRangeParams from '../hooks/useRangeParams';

const LEVEL_COLOR: Record<string, string> = {
  fatal: 'red',
  error: 'volcano',
  warning: 'orange',
  info: 'blue',
};

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  pending: { text: '待处理', color: 'red' },
  resolved: { text: '已修复', color: 'green' },
  ignored: { text: '已忽略', color: 'default' },
};

/** 迷你趋势条：用纯 DOM 实现，避免为列表渲染大量 echarts 实例 */
function Spark({ data }: { data?: number[] }) {
  if (!data || !data.length) return <span style={{ color: '#c9cdd4' }}>—</span>;
  const max = Math.max(...data, 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 22 }}>
      {data.map((value, index) => (
        <div
          key={index}
          title={`${value} 次`}
          style={{
            width: 5,
            height: `${Math.max((value / max) * 100, 6)}%`,
            background: value > 0 ? '#ff7875' : '#f0f1f2',
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  );
}

export default function Errors() {
  const params = useRangeParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState<string>('pending');
  const [level, setLevel] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);

  const { data, isLoading } = useQuery({
    queryKey: ['errors', params, keyword, status, level, page, pageSize],
    queryFn: () =>
      fetchErrors({
        ...params,
        keyword: keyword || undefined,
        status: status || undefined,
        level: level || undefined,
        page,
        pageSize,
      }),
    enabled: !!params.appKey,
  });

  const { data: trend } = useQuery({
    queryKey: ['errors-trend', params],
    queryFn: () => fetchErrorTrend(params),
    enabled: !!params.appKey,
  });

  const changeStatus = async (id: string, next: string) => {
    await updateErrorStatus(id, { status: next });
    void queryClient.invalidateQueries({ queryKey: ['errors'] });
  };

  return (
    <div className="wm-page">
      <div className="wm-page-header">
        <div>
          <h2 className="wm-page-title">错误与溯源</h2>
          <p className="wm-page-subtitle">按指纹聚合的错误分组，可下钻到行为轨迹、现场快照与会话回放</p>
        </div>
      </div>

      <div className="wm-section">
        <TrendChart
          title="错误趋势"
          data={trend}
          series={[
            { key: 'errors', name: '错误次数', color: '#f5222d', area: true },
            { key: 'users', name: '影响用户', color: '#faad14', area: false },
            { key: 'groups', name: '错误分组数', yAxisIndex: 1, color: '#722ed1', area: false },
          ]}
          height={240}
        />
      </div>

      <Space style={{ marginBottom: 12 }} wrap>
        <Segmented
          value={status}
          onChange={(value) => {
            setStatus(String(value));
            setPage(1);
          }}
          options={[
            { label: '待处理', value: 'pending' },
            { label: '已修复', value: 'resolved' },
            { label: '已忽略', value: 'ignored' },
            { label: '全部', value: '' },
          ]}
        />
        <Select
          allowClear
          placeholder="级别"
          style={{ width: 120 }}
          value={level}
          onChange={setLevel}
          options={Object.keys(LEVEL_COLOR).map((key) => ({ value: key, label: key }))}
        />
        <Input.Search
          allowClear
          placeholder="搜索错误信息 / 指纹"
          style={{ width: 300 }}
          onSearch={(value) => {
            setKeyword(value);
            setPage(1);
          }}
        />
      </Space>

      <Table<ErrorGroupItem>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={data?.list || []}
        onRow={(record) => ({
          onClick: () => navigate(`/errors/${record.id}`),
          style: { cursor: 'pointer' },
        })}
        pagination={{
          current: page,
          pageSize,
          total: data?.total || 0,
          showSizeChanger: true,
          showTotal: (total) => `共 ${total} 个错误分组`,
          onChange: (nextPage, nextSize) => {
            setPage(nextPage);
            setPageSize(nextSize);
          },
        }}
        columns={[
          {
            title: '级别',
            dataIndex: 'level',
            width: 84,
            render: (value: string) => <Tag color={LEVEL_COLOR[value] || 'default'}>{value}</Tag>,
          },
          {
            title: '错误信息',
            dataIndex: 'message',
            ellipsis: true,
            render: (message: string, record) => (
              <div>
                <Link to={`/errors/${record.id}`} style={{ color: '#1f2329' }} title={message}>
                  {message}
                </Link>
                <div style={{ fontSize: 12, color: '#a8abb2', marginTop: 2 }}>
                  {record.category} · {record.pages.slice(0, 2).join(', ') || '未知页面'}
                  {record.appVersions.length ? ` · v${record.appVersions[0]}` : ''}
                </div>
              </div>
            ),
          },
          { title: '次数', dataIndex: 'count', width: 88, align: 'right', sorter: true },
          { title: '影响用户', dataIndex: 'affectedUsers', width: 96, align: 'right' },
          { title: '影响会话', dataIndex: 'affectedSessions', width: 96, align: 'right' },
          {
            title: '近 7 天趋势',
            dataIndex: 'spark',
            width: 120,
            render: (spark: number[]) => <Spark data={spark} />,
          },
          {
            title: '最近出现',
            dataIndex: 'lastSeen',
            width: 160,
            render: (value: string) => (
              <Tooltip title={dayjs(value).format('YYYY-MM-DD HH:mm:ss')}>
                <span>{dayjs(value).format('MM-DD HH:mm')}</span>
              </Tooltip>
            ),
          },
          {
            title: '状态',
            dataIndex: 'status',
            width: 120,
            render: (value: string, record) => (
              <Select
                size="small"
                value={value}
                style={{ width: 96 }}
                onClick={(event) => event.stopPropagation()}
                onChange={(next) => void changeStatus(record.id, next)}
                options={Object.entries(STATUS_LABEL).map(([key, item]) => ({
                  value: key,
                  label: item.text,
                }))}
              />
            ),
          },
        ]}
      />

      <Typography.Paragraph type="secondary" style={{ marginTop: 12, fontSize: 12 }}>
        提示：点击任意一行进入错误详情，可查看 SourceMap 还原后的源码位置、错误发生前的用户操作轨迹与现场快照。
        <Button type="link" size="small" onClick={() => void queryClient.invalidateQueries({ queryKey: ['errors'] })}>
          刷新
        </Button>
      </Typography.Paragraph>
    </div>
  );
}
