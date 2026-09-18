import { useEffect, useMemo } from 'react';
import { Layout, Menu, Select, Space, Tag, Typography, DatePicker, Button, Tooltip } from 'antd';
import {
  AlertOutlined,
  DotChartOutlined,
  ApiOutlined,
  AreaChartOutlined,
  BarsOutlined,
  BugOutlined,
  DashboardOutlined,
  ReloadOutlined,
  SettingOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { fetchProjects } from '../api/endpoints';
import { RANGE_PRESETS, useAppStore, type RangePreset } from '../store/app';

const { Header, Sider, Content } = Layout;

const MENU_ITEMS = [
  { key: '/overview', icon: <DashboardOutlined />, label: <Link to="/overview">总览</Link> },
  { key: '/realtime', icon: <DotChartOutlined />, label: <Link to="/realtime">实时大屏</Link> },
  { key: '/performance', icon: <AreaChartOutlined />, label: <Link to="/performance">性能分析</Link> },
  { key: '/errors', icon: <BugOutlined />, label: <Link to="/errors">错误与溯源</Link> },
  { key: '/behavior', icon: <BarsOutlined />, label: <Link to="/behavior">用户行为</Link> },
  { key: '/sessions', icon: <ApiOutlined />, label: <Link to="/sessions">会话与回放</Link> },
  { key: '/users', icon: <UserOutlined />, label: <Link to="/users">用户细查</Link> },
  { key: '/projects', icon: <SettingOutlined />, label: <Link to="/projects">应用管理</Link> },
  { key: '/alerts', icon: <AlertOutlined />, label: <Link to="/alerts">告警管理</Link> },
  { key: '/connect', icon: <TeamOutlined />, label: <Link to="/connect">接入指南</Link> },
];

export default function AppLayout() {
  const location = useLocation();
  const { appKey, appName, env, preset, customRange, setProject, setEnv, setPreset, setCustomRange } =
    useAppStore();

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
  });

  // 首次进入时自动选中第一个应用，避免所有页面空转
  useEffect(() => {
    if (!appKey && projects?.length) {
      setProject({ appKey: projects[0].appKey, name: projects[0].name });
    }
  }, [appKey, projects, setProject]);

  const selectedKey = useMemo(() => {
    const match = MENU_ITEMS.map((item) => item.key)
      .filter((key) => location.pathname.startsWith(key))
      .sort((a, b) => b.length - a.length)[0];
    return match || '/overview';
  }, [location.pathname]);

  const currentProject = projects?.find((item) => item.appKey === appKey);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={208} theme="light" style={{ borderRight: '1px solid #f0f1f2' }}>
        <div style={{ padding: '18px 20px' }}>
          <Typography.Text strong style={{ fontSize: 16 }}>
            web-monitor
          </Typography.Text>
          <div style={{ fontSize: 12, color: '#8a9099', marginTop: 2 }}>前端监控平台</div>
        </div>
        <Menu mode="inline" selectedKeys={[selectedKey]} items={MENU_ITEMS} style={{ borderInlineEnd: 'none' }} />
      </Sider>

      <Layout>
        <Header
          style={{
            background: '#fff',
            borderBottom: '1px solid #f0f1f2',
            padding: '0 20px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            height: 56,
          }}
        >
          <Select
            value={appKey || undefined}
            placeholder="选择应用"
            style={{ minWidth: 200 }}
            onChange={(value) => {
              const project = projects?.find((item) => item.appKey === value);
              setProject({ appKey: value, name: project?.name || '' });
            }}
            options={(projects || []).map((project) => ({
              value: project.appKey,
              label: `${project.name}（${project.appKey}）`,
            }))}
          />

          <Select
            value={env}
            allowClear
            placeholder="全部环境"
            style={{ minWidth: 130 }}
            onChange={(value) => setEnv(value)}
            options={(currentProject?.envs || ['production', 'staging', 'development']).map((item) => ({
              value: item,
              label: item,
            }))}
          />

          <Select
            value={preset}
            style={{ minWidth: 140 }}
            onChange={(value) => setPreset(value as RangePreset)}
            options={RANGE_PRESETS.map((item) => ({ value: item.key, label: item.label }))}
          />

          <DatePicker.RangePicker
            showTime
            allowClear
            value={
              customRange
                ? [dayjs(customRange[0]), dayjs(customRange[1])]
                : undefined
            }
            onChange={(values) => {
              if (!values || !values[0] || !values[1]) setCustomRange(undefined);
              else setCustomRange([values[0].valueOf(), values[1].valueOf()]);
            }}
          />

          <div style={{ flex: 1 }} />

          {appName ? <Tag color="blue">{appName}</Tag> : null}
          <Tooltip title="全部数据每 30 秒自动刷新，可手动强制刷新">
            <Button
              icon={<ReloadOutlined />}
              type="text"
              onClick={() => window.location.reload()}
            />
          </Tooltip>
        </Header>

        <Content style={{ overflow: 'auto' }}>
          {appKey ? (
            <Outlet />
          ) : (
            <div className="wm-page">
              <Typography.Title level={4}>请先在「应用管理」创建或选择一个应用</Typography.Title>
              <Space>
                <Link to="/projects">前往应用管理</Link>
              </Space>
            </div>
          )}
        </Content>
      </Layout>
    </Layout>
  );
}
