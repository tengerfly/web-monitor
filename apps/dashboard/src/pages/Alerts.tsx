import { useState } from 'react';
import {
  Button,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AlertChannel, AlertRecord, AlertRule, AlertRuleDto } from '@web-monitor/types';
import {
  createAlertRule,
  deleteAlertRule,
  fetchAlertRecords,
  fetchAlertRules,
  updateAlertRule,
} from '../api/endpoints';
import { useAppStore } from '../store/app';

const METRIC_OPTIONS: Array<{ value: AlertRule['metric']; label: string; unit?: string }> = [
  { value: 'error_count', label: '错误次数（次）' },
  { value: 'error_rate', label: '错误率（0-1）' },
  { value: 'affected_users', label: '受影响用户数（人）' },
  { value: 'new_error', label: '新增错误分组数（个）' },
  { value: 'p95_latency', label: '接口 P95 耗时（ms）' },
  { value: 'api_error_rate', label: '接口错误率（0-1）' },
  { value: 'lcp_p75', label: 'LCP P75（ms）' },
  { value: 'white_screen', label: '白屏次数（次）' },
  { value: 'slow_api_count', label: '慢接口数（>1s）' },
];

const CHANNEL_OPTIONS: Array<{ value: AlertChannel['type']; label: string; placeholder: string }> = [
  { value: 'email', label: '邮件', placeholder: 'a@x.com,b@x.com' },
  { value: 'webhook', label: '通用 Webhook', placeholder: 'https://your-service/hook' },
  { value: 'dingtalk', label: '钉钉机器人', placeholder: 'https://oapi.dingtalk.com/robot/send?access_token=xxx' },
  { value: 'wecom', label: '企业微信机器人', placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx' },
  { value: 'feishu', label: '飞书机器人', placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/xxx' },
];

export default function Alerts() {
  const appKey = useAppStore((state) => state.appKey);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AlertRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [channels, setChannels] = useState<AlertChannel[]>([]);
  const [form] = Form.useForm<AlertRuleDto>();

  const { data: rules, isLoading } = useQuery({
    queryKey: ['alert-rules', appKey],
    queryFn: () => fetchAlertRules(appKey),
    enabled: !!appKey,
  });

  const { data: records } = useQuery({
    queryKey: ['alert-records', appKey],
    queryFn: () => fetchAlertRecords({ appKey, page: 1, pageSize: 50 }),
    enabled: !!appKey,
    refetchInterval: 60_000,
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['alert-rules'] });

  const saveMutation = useMutation({
    mutationFn: async (values: AlertRuleDto) => {
      const payload = { ...values, channels };
      if (editing) return updateAlertRule(editing.id, payload);
      return createAlertRule(appKey, payload);
    },
    onSuccess: () => {
      message.success('已保存');
      setEditing(null);
      setCreating(false);
      setChannels([]);
      form.resetFields();
      refresh();
    },
  });

  const openEditor = (rule?: AlertRule) => {
    if (rule) {
      setEditing(rule);
      setChannels(rule.channels || []);
      form.setFieldsValue({
        name: rule.name,
        enabled: rule.enabled,
        metric: rule.metric,
        operator: rule.operator,
        threshold: rule.threshold,
        window: rule.window,
        silence: rule.silence,
        minCount: rule.minCount,
      });
    } else {
      setCreating(true);
      setChannels([]);
      form.setFieldsValue({
        enabled: true,
        metric: 'error_count',
        operator: 'gt',
        threshold: 10,
        window: 5,
        silence: 30,
        minCount: 1,
      } as AlertRuleDto);
    }
  };

  return (
    <div className="wm-page">
      <div className="wm-page-header">
        <div>
          <h2 className="wm-page-title">告警管理</h2>
          <p className="wm-page-subtitle">
            按「指标 × 阈值 × 统计窗口 × 静默期」定义规则，触发后通过邮件/Webhook 通知
          </p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={refresh}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor()}>
            新建规则
          </Button>
        </Space>
      </div>

      <Tabs
        items={[
          {
            key: 'rules',
            label: '告警规则',
            children: (
              <Table<AlertRule>
                size="small"
                rowKey="id"
                loading={isLoading}
                dataSource={rules || []}
                pagination={false}
                columns={[
                  { title: '规则名称', dataIndex: 'name' },
                  {
                    title: '启用',
                    dataIndex: 'enabled',
                    width: 80,
                    render: (value: boolean) => (value ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
                  },
                  {
                    title: '触发条件',
                    width: 300,
                    render: (_: unknown, record) => (
                      <span>
                        {METRIC_OPTIONS.find((item) => item.value === record.metric)?.label ||
                          record.metric}{' '}
                        <b>{record.operator}</b> <b>{record.threshold}</b>
                      </span>
                    ),
                  },
                  {
                    title: '统计窗口',
                    dataIndex: 'window',
                    width: 100,
                    align: 'right',
                    render: (value: number) => `${value} 分钟`,
                  },
                  {
                    title: '静默期',
                    dataIndex: 'silence',
                    width: 100,
                    align: 'right',
                    render: (value: number) => `${value} 分钟`,
                  },
                  {
                    title: '通知渠道',
                    dataIndex: 'channels',
                    width: 220,
                    render: (list: AlertChannel[]) =>
                      list?.length ? (
                        list.map((item, index) => <Tag key={index}>{item.type}</Tag>)
                      ) : (
                        <span style={{ color: '#8a9099', fontSize: 12 }}>未配置（仅记录）</span>
                      ),
                  },
                  {
                    title: '操作',
                    width: 140,
                    render: (_: unknown, record) => (
                      <Space>
                        <a onClick={() => openEditor(record)}>编辑</a>
                        <Popconfirm
                          title="删除该规则？"
                          onConfirm={async () => {
                            await deleteAlertRule(record.id);
                            refresh();
                          }}
                        >
                          <a style={{ color: '#f5222d' }}>删除</a>
                        </Popconfirm>
                      </Space>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'records',
            label: '触发记录',
            children: (
              <Table<AlertRecord>
                size="small"
                rowKey="id"
                dataSource={records?.list || []}
                pagination={{ pageSize: 20 }}
                columns={[
                  {
                    title: '触发时间',
                    dataIndex: 'triggeredAt',
                    width: 190,
                    render: (value: string) => value.replace('T', ' ').slice(0, 19),
                  },
                  { title: '规则', dataIndex: 'ruleName', width: 240, ellipsis: true },
                  { title: '指标', dataIndex: 'metric', width: 150 },
                  {
                    title: '当前值 / 阈值',
                    width: 180,
                    render: (_: unknown, record) => (
                      <span>
                        <b style={{ color: '#f5222d' }}>{record.value}</b> / {record.threshold}
                      </span>
                    ),
                  },
                  {
                    title: '状态',
                    dataIndex: 'status',
                    width: 100,
                    render: (value: string) =>
                      value === 'firing' ? <Tag color="red">告警中</Tag> : <Tag color="green">已恢复</Tag>,
                  },
                  {
                    title: '已通知',
                    dataIndex: 'notified',
                    width: 90,
                    render: (value: boolean) => (value ? '是' : '否'),
                  },
                  {
                    title: '详情',
                    dataIndex: 'message',
                    ellipsis: true,
                    render: (value: string) => <span style={{ fontSize: 12, color: '#646a73' }}>{value}</span>,
                  },
                ]}
              />
            ),
          },
        ]}
      />

      <Modal
        open={creating || !!editing}
        title={editing ? `编辑规则：${editing.name}` : '新建告警规则'}
        width={640}
        onCancel={() => {
          setCreating(false);
          setEditing(null);
          form.resetFields();
        }}
        onOk={() => form.validateFields().then((values) => saveMutation.mutate(values))}
        confirmLoading={saveMutation.isPending}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]}>
            <Input placeholder="例如：5 分钟错误数超过 10" />
          </Form.Item>
          <Space size="large" wrap>
            <Form.Item name="metric" label="监控指标" rules={[{ required: true }]}>
              <Select style={{ width: 240 }} options={METRIC_OPTIONS} />
            </Form.Item>
            <Form.Item name="operator" label="比较方式" rules={[{ required: true }]}>
              <Select
                style={{ width: 120 }}
                options={[
                  { value: 'gt', label: '大于 >' },
                  { value: 'gte', label: '大于等于 ≥' },
                  { value: 'lt', label: '小于 <' },
                  { value: 'lte', label: '小于等于 ≤' },
                ]}
              />
            </Form.Item>
            <Form.Item name="threshold" label="阈值" rules={[{ required: true }]}>
              <InputNumber style={{ width: 140 }} step={0.1} />
            </Form.Item>
          </Space>
          <Space size="large" wrap>
            <Form.Item name="window" label="统计窗口（分钟）" rules={[{ required: true }]}>
              <InputNumber min={1} max={1440} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="silence" label="静默期（分钟）">
              <InputNumber min={0} max={1440} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="minCount" label="最小触发样本量">
              <InputNumber min={0} style={{ width: 160 }} />
            </Form.Item>
          </Space>
          <Form.Item label="启用状态" name="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>

          <Form.Item label="通知渠道">
            <Space direction="vertical" style={{ width: '100%' }}>
              {channels.map((channel, index) => (
                <Space key={index} style={{ width: '100%' }}>
                  <Select
                    style={{ width: 140 }}
                    value={channel.type}
                    onChange={(value) => {
                      const next = [...channels];
                      next[index] = { ...channel, type: value };
                      setChannels(next);
                    }}
                    options={CHANNEL_OPTIONS.map((item) => ({ value: item.value, label: item.label }))}
                  />
                  <Input
                    style={{ width: 340 }}
                    value={channel.target}
                    placeholder={
                      CHANNEL_OPTIONS.find((item) => item.value === channel.type)?.placeholder
                    }
                    onChange={(event) => {
                      const next = [...channels];
                      next[index] = { ...channel, target: event.target.value };
                      setChannels(next);
                    }}
                  />
                  <a style={{ color: '#f5222d' }} onClick={() => setChannels(channels.filter((_, i) => i !== index))}>
                    移除
                  </a>
                </Space>
              ))}
              <Button
                size="small"
                icon={<PlusOutlined />}
                onClick={() => setChannels([...channels, { type: 'webhook', target: '' }])}
              >
                添加渠道
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
