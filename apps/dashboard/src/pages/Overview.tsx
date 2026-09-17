import { Card, Col, Row, Table, Tag } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchErrors, fetchOverview } from '../api/endpoints';
import StatCard from '../components/StatCard';
import TrendChart from '../components/TrendChart';
import useRangeParams from '../hooks/useRangeParams';
import { useAppStore } from '../store/app';
import type { ErrorGroupItem } from '@web-monitor/types';

const LEVEL_COLOR: Record<string, string> = {
  fatal: 'red',
  error: 'volcano',
  warning: 'orange',
  info: 'blue',
};

export default function Overview() {
  const params = useRangeParams();
  const appName = useAppStore((state) => state.appName);

  const { data, isLoading } = useQuery({
    queryKey: ['overview', params],
    queryFn: () => fetchOverview(params),
    enabled: !!params.appKey,
    refetchInterval: 60_000,
  });

  const { data: topErrors } = useQuery({
    queryKey: ['overview-errors', params],
    queryFn: () => fetchErrors({ ...params, page: 1, pageSize: 5, status: 'pending' }),
    enabled: !!params.appKey,
  });

  const metrics = data?.metrics;

  return (
    <div className="wm-page">
      <div className="wm-page-header">
        <div>
          <h2 className="wm-page-title">总览</h2>
          <p className="wm-page-subtitle">{appName || '未选择应用'}</p>
        </div>
      </div>

      <Row gutter={[12, 12]} className="wm-section">
        <Col xs={12} md={6} xl={4}>
          <StatCard label="页面访问量 PV" value={metrics?.pv} loading={isLoading} delta={data?.compare?.pv} />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <StatCard label="独立访客 UV" value={metrics?.uv} loading={isLoading} delta={data?.compare?.uv} />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <StatCard
            label="会话数"
            value={metrics?.sessions}
            loading={isLoading}
            delta={data?.compare?.sessions}
          />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <StatCard
            label="新访客"
            value={metrics?.newUsers}
            loading={isLoading}
            delta={data?.compare?.newUsers}
          />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <StatCard
            label="跳出率"
            value={metrics ? metrics.bounceRate * 100 : undefined}
            unit="%"
            precision={1}
            loading={isLoading}
            inverse
            delta={data?.compare?.bounceRate}
          />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <StatCard
            label="平均会话时长"
            value={metrics ? Math.round(metrics.avgSessionDuration / 1000) : undefined}
            unit="秒"
            loading={isLoading}
            delta={data?.compare?.avgSessionDuration}
          />
        </Col>
      </Row>

      <Row gutter={[12, 12]} className="wm-section">
        <Col xs={12} md={6} xl={4}>
          <StatCard
            label="错误数"
            value={metrics?.errorCount}
            loading={isLoading}
            inverse
            delta={data?.compare?.errorCount}
          />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <StatCard
            label="错误率"
            value={metrics ? metrics.errorRate * 100 : undefined}
            unit="%"
            precision={2}
            loading={isLoading}
            inverse
            tip="错误数 / 页面访问量"
            delta={data?.compare?.errorRate}
          />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <StatCard
            label="受影响用户"
            value={metrics?.affectedUsers}
            loading={isLoading}
            inverse
            delta={data?.compare?.affectedUsers}
          />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <StatCard
            label="性能评分"
            value={metrics?.score}
            loading={isLoading}
            tip="基于 LCP / INP / CLS 的加权评分，越高越好"
            delta={data?.compare?.score}
          />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <StatCard
            label="接口成功率"
            value={metrics ? metrics.apiSuccessRate * 100 : undefined}
            unit="%"
            precision={2}
            loading={isLoading}
            delta={data?.compare?.apiSuccessRate}
          />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <StatCard
            label="平均接口耗时"
            value={metrics?.avgApiDuration}
            unit="ms"
            loading={isLoading}
            inverse
            delta={data?.compare?.avgApiDuration}
          />
        </Col>
      </Row>

      <Row gutter={[12, 12]} className="wm-section">
        <Col xs={12} md={6} xl={4}>
          <StatCard
            label="平均加载耗时"
            value={metrics?.avgPageLoad}
            unit="ms"
            loading={isLoading}
            inverse
          />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <StatCard label="平均 LCP" value={metrics?.avgLcp} unit="ms" loading={isLoading} inverse />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <StatCard label="平均 INP" value={metrics?.avgInp} unit="ms" loading={isLoading} inverse />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <StatCard
            label="平均 CLS"
            value={metrics?.avgCls}
            precision={3}
            loading={isLoading}
            inverse
          />
        </Col>
        <Col xs={12} md={6} xl={4}>
          <StatCard
            label="Core Vitals 达标率"
            value={metrics ? metrics.vitalsPassRate * 100 : undefined}
            unit="%"
            precision={1}
            loading={isLoading}
            tip="LCP ≤ 2.5s、INP ≤ 200ms、CLS ≤ 0.1 的占比"
          />
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={16}>
          <TrendChart
            title="流量与错误趋势"
            loading={isLoading}
            data={data?.trend}
            series={[
              { key: 'pv', name: 'PV', area: true },
              { key: 'uv', name: 'UV' },
              { key: 'errors', name: '错误数', yAxisIndex: 1, color: '#f5222d', area: false },
            ]}
            height={320}
          />
        </Col>
        <Col xs={24} xl={8}>
          <Card size="small" title="待处理错误 Top 5" styles={{ body: { padding: 0 } }}>
            <Table<ErrorGroupItem>
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={topErrors?.list || []}
              locale={{ emptyText: '暂无待处理错误' }}
              columns={[
                {
                  title: '错误',
                  dataIndex: 'message',
                  ellipsis: true,
                  render: (message: string, record) => (
                    <Link to={`/errors/${record.id}`} title={message}>
                      <Tag color={LEVEL_COLOR[record.level] || 'default'}>{record.level}</Tag>
                      {message}
                    </Link>
                  ),
                },
                { title: '次数', dataIndex: 'count', width: 72, align: 'right' },
                { title: '影响用户', dataIndex: 'affectedUsers', width: 88, align: 'right' },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
