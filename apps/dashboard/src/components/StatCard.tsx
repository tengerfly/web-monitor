import { Card, Skeleton, Tooltip } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined } from '@ant-design/icons';

export interface StatCardProps {
  label: string;
  value: number | string | undefined;
  unit?: string;
  loading?: boolean;
  precision?: number;
  /** 环比变化率（0.12 表示上升 12%） */
  delta?: number;
  /** 变化方向是否为「越低越好」 */
  inverse?: boolean;
  tip?: string;
  suffix?: React.ReactNode;
}

function formatNumber(value: number | string | undefined, precision: number): string {
  if (value === undefined || value === null || value === '') return '-';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  if (Math.abs(numeric) >= 100000000) return `${(numeric / 100000000).toFixed(2)} 亿`;
  if (Math.abs(numeric) >= 10000) return `${(numeric / 10000).toFixed(2)} 万`;
  return numeric.toLocaleString('zh-CN', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

/** 指标卡片：数值 + 环比 + 说明 */
export default function StatCard(props: StatCardProps) {
  const { label, value, unit, loading, precision = 0, delta, inverse, tip, suffix } = props;

  const positive = delta !== undefined && delta >= 0;
  const good = delta === undefined ? undefined : inverse ? !positive : positive;

  return (
    <Card size="small" styles={{ body: { padding: 16 } }}>
      <div className="wm-stat-label">
        {tip ? <Tooltip title={tip}>{label}</Tooltip> : label}
      </div>
      {loading ? (
        <Skeleton active paragraph={false} title={{ width: '60%' }} style={{ marginTop: 8 }} />
      ) : (
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span className="wm-stat-value">{formatNumber(value, precision)}</span>
          {unit ? <span className="wm-stat-unit">{unit}</span> : null}
          {suffix}
          {delta !== undefined && Number.isFinite(delta) ? (
            <span
              style={{
                marginLeft: 'auto',
                fontSize: 12,
                color: good ? '#52c41a' : '#f5222d',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              {positive ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
              {Math.abs(delta * 100).toFixed(1)}%
            </span>
          ) : null}
        </div>
      )}
    </Card>
  );
}
