import { useState } from 'react';
import {
  Button,
  Card,
  Drawer,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload,
} from 'antd';
import { CopyOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Project, ProjectCreateDto, SourceMapItem } from '@web-monitor/types';
import {
  createProject,
  deleteProject,
  fetchProjects,
  fetchSourceMaps,
  rotateAppKey,
  updateProject,
  uploadSourceMap,
  deleteSourceMap,
} from '../api/endpoints';
import { useAppStore } from '../store/app';

const PLUGIN_LABELS: Record<string, string> = {
  performance: '性能监控',
  behavior: '用户行为追踪',
  error: '错误与溯源',
  replay: '会话回放',
};

export default function Projects() {
  const queryClient = useQueryClient();
  const { appKey, setProject } = useAppStore();
  const [editing, setEditing] = useState<Project | null>(null);
  const [creating, setCreating] = useState(false);
  const [snippetProject, setSnippetProject] = useState<Project | null>(null);
  const [form] = Form.useForm<ProjectCreateDto>();

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['projects'] });

  const createMutation = useMutation({
    mutationFn: (values: ProjectCreateDto) => createProject(values),
    onSuccess: (project) => {
      message.success(`应用创建成功：${project.appKey}`);
      setCreating(false);
      form.resetFields();
      refresh();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ key, values }: { key: string; values: ProjectCreateDto }) =>
      updateProject(key, values),
    onSuccess: () => {
      message.success('已保存');
      setEditing(null);
      refresh();
    },
  });

  return (
    <div className="wm-page">
      <div className="wm-page-header">
        <div>
          <h2 className="wm-page-title">应用管理</h2>
          <p className="wm-page-subtitle">
            每个应用对应一个 appKey，采样率、能力开关与脱敏规则均可在服务端在线调整，前端无需发版
          </p>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={refresh}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            新建应用
          </Button>
        </Space>
      </div>

      <Table<Project>
        size="small"
        rowKey="appKey"
        loading={isLoading}
        dataSource={projects || []}
        pagination={false}
        columns={[
          {
            title: '应用',
            render: (_: unknown, record) => (
              <div>
                <Space>
                  <a onClick={() => setProject({ appKey: record.appKey, name: record.name })}>
                    {record.name}
                  </a>
                  {record.appKey === appKey ? <Tag color="blue">当前</Tag> : null}
                </Space>
                <div style={{ fontSize: 12, color: '#a8abb2' }}>{record.description || '—'}</div>
              </div>
            ),
          },
          {
            title: 'appKey',
            dataIndex: 'appKey',
            width: 200,
            render: (value: string) => (
              <Space>
                <Typography.Text code copyable={{ icon: <CopyOutlined /> }}>
                  {value}
                </Typography.Text>
              </Space>
            ),
          },
          {
            title: '能力开关',
            dataIndex: 'plugins',
            width: 320,
            render: (plugins: Record<string, boolean>) => (
              <>
                {Object.entries(PLUGIN_LABELS).map(([key, label]) => (
                  <Tag key={key} color={plugins?.[key] ? 'green' : 'default'}>
                    {label}
                  </Tag>
                ))}
              </>
            ),
          },
          {
            title: '采样率',
            dataIndex: 'sampleRate',
            width: 100,
            align: 'right',
            render: (value: number) => `${(value * 100).toFixed(0)}%`,
          },
          {
            title: '环境',
            dataIndex: 'envs',
            width: 200,
            render: (envs: string[]) => envs.map((env) => <Tag key={env}>{env}</Tag>),
          },
          {
            title: '操作',
            width: 260,
            render: (_: unknown, record) => (
              <Space>
                <a
                  onClick={() => {
                    setEditing(record);
                    form.setFieldsValue(record as unknown as ProjectCreateDto);
                  }}
                >
                  编辑
                </a>
                <a onClick={() => setSnippetProject(record)}>接入代码</a>
                <Popconfirm
                  title="重置 appKey？"
                  description="旧 appKey 将立即失效，历史数据保留但需要重新接入。"
                  onConfirm={async () => {
                    await rotateAppKey(record.appKey);
                    message.success('appKey 已重置');
                    refresh();
                  }}
                >
                  <a>重置 Key</a>
                </Popconfirm>
                <Popconfirm
                  title="删除应用？"
                  description="该应用在 PostgreSQL 中的配置将被删除，ClickHouse 中的历史数据仍会按 TTL 自然过期。"
                  onConfirm={async () => {
                    await deleteProject(record.appKey);
                    message.success('已删除');
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

      <Modal
        open={creating || !!editing}
        title={editing ? `编辑应用：${editing.name}` : '新建应用'}
        onCancel={() => {
          setCreating(false);
          setEditing(null);
          form.resetFields();
        }}
        onOk={() => {
          form.validateFields().then((values) => {
            if (editing) updateMutation.mutate({ key: editing.appKey, values });
            else createMutation.mutate(values);
          });
        }}
        confirmLoading={createMutation.isPending || updateMutation.isPending}
        width={640}
      >
        <Form form={form} layout="vertical" initialValues={{ sampleRate: 1, retentionDays: 90 }}>
          <Form.Item name="name" label="应用名称" rules={[{ required: true, message: '请输入应用名称' }]}>
            <Input placeholder="例如：商城前台 Web" />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={2} placeholder="用途、负责人等" />
          </Form.Item>
          <Space size="large">
            <Form.Item name="sampleRate" label="全局采样率">
              <InputNumber min={0} max={1} step={0.1} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item name="retentionDays" label="数据保留天数">
              <InputNumber min={1} max={365} style={{ width: 160 }} />
            </Form.Item>
          </Space>
          <Form.Item name="envs" label="环境（逗号分隔）">
            <Input placeholder="production,staging,development" />
          </Form.Item>
          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            能力开关、阈值与脱敏规则可在创建后通过接口按需调整；性能、行为、错误、回放四个能力彼此独立，
            可只开启需要的组合。
          </Typography.Paragraph>
        </Form>
      </Modal>

      <Drawer
        open={!!snippetProject}
        onClose={() => setSnippetProject(null)}
        width={720}
        title={`接入代码：${snippetProject?.name || ''}`}
      >
        {snippetProject ? <SnippetPanel project={snippetProject} /> : null}
      </Drawer>
    </div>
  );
}

/** 接入代码 + SourceMap 管理 */
function SnippetPanel({ project }: { project: Project }) {
  const host = window.location.origin.replace(/:\d+$/, ':8787');
  const enabled = Object.entries(project.plugins || {})
    .filter(([, value]) => value)
    .map(([key]) => key);

  const scriptCode = `<script>
  (function(w,d,s){
    var m=d.createElement(s);m.async=1;
    m.src="${host}/sdk/web-monitor.umd.min.js";
    m.onload=function(){
      var monitor=w.WebMonitor.createMonitor({
        appKey:"${project.appKey}",
        host:"${host}",
        env:"production",
        appVersion:"1.0.0",
        plugins:[
${enabled.map((name) => `          w.WebMonitor.${name}Plugin({})`).join(',\n')}
        ]
      });
      monitor.start();
    };
    d.head.appendChild(m);
  })(window,document,"script");
</script>`;

  const npmCode = `pnpm add @web-monitor/core${enabled
    .map((name) => ` @web-monitor/${name}`)
    .join('')}

import { createMonitor } from '@web-monitor/core';
${enabled.map((name) => `import { ${name}Plugin } from '@web-monitor/${name}';`).join('\n')}

const monitor = createMonitor({
  appKey: '${project.appKey}',
  host: '${host}',
  env: 'production',
  appVersion: '1.0.0',
  plugins: [
${enabled.map((name) => `    ${name}Plugin({ /* 可按需覆盖配置 */ }),`).join('\n')}
  ],
});

monitor.start();

// 用户登录后绑定身份，串联登录前后的行为
monitor.identify('user_10086', { plan: 'pro' });

// 自定义埋点
monitor.track('order_submit', { orderId: 'A2026' });`;

  return (
    <Tabs
      items={[
        {
          key: 'npm',
          label: 'npm 接入（推荐）',
          children: <CodeBlock code={npmCode} />,
        },
        {
          key: 'script',
          label: 'CDN / script 接入',
          children: <CodeBlock code={scriptCode} />,
        },
        {
          key: 'sourcemap',
          label: 'SourceMap 管理',
          children: <SourceMapPanel appKey={project.appKey} />,
        },
      ]}
    />
  );
}

function CodeBlock({ code }: { code: string }) {
  const [messageApi, contextHolder] = message.useMessage();
  return (
    <>
      {contextHolder}
      <Space style={{ marginBottom: 8 }}>
        <Button
          size="small"
          icon={<CopyOutlined />}
          onClick={async () => {
            await navigator.clipboard.writeText(code);
            messageApi.success('已复制');
          }}
        >
          复制
        </Button>
      </Space>
      <div className="wm-code-block">{code}</div>
    </>
  );
}

function SourceMapPanel({ appKey }: { appKey: string }) {
  const queryClient = useQueryClient();
  const [appVersion, setAppVersion] = useState('1.0.0');
  const { data } = useQuery({
    queryKey: ['sourcemaps', appKey, appVersion],
    queryFn: () => fetchSourceMaps(appKey, appVersion),
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['sourcemaps'] });

  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Input
          value={appVersion}
          onChange={(event) => setAppVersion(event.target.value)}
          placeholder="版本号"
          style={{ width: 160 }}
        />
        <Upload
          accept=".map"
          showUploadList={false}
          beforeUpload={(file) => {
            const reader = new FileReader();
            reader.onload = async () => {
              await uploadSourceMap(appKey, {
                appVersion,
                fileName: file.name.replace(/\.map$/, ''),
                content: String(reader.result || ''),
              });
              message.success('已上传');
              refresh();
            };
            reader.readAsText(file);
            return false;
          }}
        >
          <Button icon={<UploadOutlined />}>上传 .map 文件</Button>
        </Upload>
      </Space>
      <Table<SourceMapItem>
        size="small"
        rowKey="id"
        dataSource={data || []}
        pagination={false}
        columns={[
          { title: '文件', dataIndex: 'fileName', ellipsis: true },
          { title: '版本', dataIndex: 'appVersion', width: 100 },
          {
            title: '大小',
            dataIndex: 'size',
            width: 100,
            align: 'right',
            render: (value: number) => `${(value / 1024).toFixed(1)} KB`,
          },
          {
            title: '上传时间',
            dataIndex: 'createdAt',
            width: 170,
            render: (value: string) => value.replace('T', ' ').slice(0, 19),
          },
          {
            title: '操作',
            width: 80,
            render: (_: unknown, record) => (
              <Popconfirm
                title="删除该 SourceMap？"
                onConfirm={async () => {
                  await deleteSourceMap(record.id);
                  refresh();
                }}
              >
                <a style={{ color: '#f5222d' }}>删除</a>
              </Popconfirm>
            ),
          },
        ]}
      />
      <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8 }}>
        上传的文件名需与构建产物一致（如 <code>app.1a2b3c4d.js</code>，不带 .map 后缀），
        服务端会用错误堆栈中的文件 basename 自动匹配。
      </Typography.Paragraph>
    </div>
  );
}

export { Card, Switch };
