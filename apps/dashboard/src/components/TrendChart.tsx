import { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { Card, Empty, Segmented, Space } from 'antd';
import dayjs from 'dayjs';
import type { TrendPoint } from '@web-monitor/types';

export interface SeriesConfig {
  key: string;
  name: string;
  /** 是否使用右侧 Y 轴（量级差异大的指标分轴展示） */
  yAxisIndex?: number;
  type?: 'line' | 'bar';
  color?: string;
  area?: boolean;
}

export interface TrendChartProps {
  title?: string;
  data: TrendPoint[] | undefined;
  series: SeriesConfig[];
  loading?: boolean;
  height?: number;
  /** 额外的右上角操作区 */
  extra?: React.ReactNode;
}

const PALETTE = ['#1677ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2', '#eb2f96'];

/**
 * 通用趋势图。
 * 统一处理：时间轴格式化、多 Y 轴、空数据、面积填充，页面侧只需声明 series。
 */
export default function TrendChart(props: TrendChartProps) {
  const { title, data, series, loading, height = 300, extra } = props;

  const option = useMemo(() => {
    const rows = data || [];
    const times = rows.map((row) => dayjs(String(row.time)).format('MM-DD HH:mm'));

    return {
      grid: { left: 48, right: series.some((item) => item.yAxisIndex === 1) ? 56 : 24, top: 36, bottom: 36 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', label: { backgroundColor: '#6a7985' } },
      },
      legend: { top: 0, right: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10 },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: times,
        axisLine: { lineStyle: { color: '#e5e6eb' } },
        axisLabel: { color: '#8a9099', hideOverlap: true },
      },
      yAxis: [
        {
          type: 'value',
          name: '',
          splitLine: { lineStyle: { color: '#f0f1f2' } },
          axisLabel: { color: '#8a9099' },
        },
        {
          type: 'value',
          show: series.some((item) => item.yAxisIndex === 1),
          splitLine: { show: false },
          axisLabel: { color: '#8a9099' },
        },
      ],
      series: series.map((item, index) => ({
        name: item.name,
        type: item.type || 'line',
        yAxisIndex: item.yAxisIndex || 0,
        smooth: true,
        showSymbol: false,
        barMaxWidth: 18,
        lineStyle: { width: 2, color: item.color || PALETTE[index % PALETTE.length] },
        itemStyle: { color: item.color || PALETTE[index % PALETTE.length] },
        areaStyle:
          item.area === false || item.type === 'bar'
            ? undefined
            : {
                opacity: 0.12,
                color: item.color || PALETTE[index % PALETTE.length],
              },
        data: rows.map((row) => {
          const value = row[item.key];
          return value === undefined ? null : Number(value);
        }),
      })),
    };
  }, [data, series]);

  return (
    <Card
      size="small"
      title={title}
      extra={extra}
      loading={loading}
      styles={{ body: { paddingTop: 8 } }}
    >
      {!data || !data.length ? (
        <div className="wm-empty">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前时间范围内暂无数据" />
        </div>
      ) : (
        <ReactECharts option={option} style={{ height }} notMerge lazyUpdate />
      )}
    </Card>
  );
}

/** 图表右上角的度量切换（均值 / P95 等） */
export function ChartMetricSwitch(props: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
}) {
  return <Segmented size="small" value={props.value} onChange={(v) => props.onChange(String(v))} options={props.options} />;
}

export { Space };
