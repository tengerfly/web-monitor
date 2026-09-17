import { Alert, Card, Col, Row, Table, Tag, Typography } from 'antd';
import { CheckCircleTwoTone, CloseCircleOutlined } from '@ant-design/icons';

const PACKAGES = [
  { name: '@web-monitor/core', desc: '采集底座：会话、上下文、上报管道、埋点 API、插件体系', required: true },
  { name: '@web-monitor/performance', desc: '性能监控：Core Web Vitals、加载阶段、资源与接口耗时、长任务', required: false },
  { name: '@web-monitor/behavior', desc: '用户行为：PV/UV、路由、点击、曝光、表单、滚动、自定义埋点', required: false },
  { name: '@web-monitor/error', desc: '错误与溯源：错误采集、指纹聚合、行为轨迹、现场快照', required: false },
  { name: '@web-monitor/replay', desc: '会话回放：DOM 快照录制 + 增量变更 + 轻量播放器', required: false },
  { name: '@web-monitor/react', desc: 'React 适配：Provider、Hooks、错误边界、路由埋点', required: false },
  { name: '@web-monitor/vue', desc: 'Vue 3 适配：插件安装、errorHandler 接管、路由埋点、组合式 API', required: false },
  { name: '@web-monitor/types', desc: '协议类型：SDK / 服务端 / 看板共用的唯一定义源', required: false },
];

const MATRIX = [
  { scene: '只看性能（CDN / 静态站）', packages: ['core', 'performance'], size: '~18KB gzip' },
  { scene: '只看行为埋点', packages: ['core', 'behavior'], size: '~16KB gzip' },
  { scene: '性能 + 错误溯源', packages: ['core', 'performance', 'error'], size: '~26KB gzip' },
  { scene: '全量（含行为与回放）', packages: ['core', 'performance', 'behavior', 'error', 'replay'], size: '~38KB gzip' },
];

export default function Connect() {
  return (
    <div className="wm-page">
      <div className="wm-page-header">
        <div>
          <h2 className="wm-page-title">接入指南</h2>
          <p className="wm-page-subtitle">
            性能监控与用户行为追踪物理分离，按需引入；四个能力包可任意组合
          </p>
        </div>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="最小接入只需 3 行代码"
        description={
          <div className="wm-code-block" style={{ marginTop: 8 }}>
            {`import { createMonitor } from '@web-monitor/core';
import { errorPlugin } from '@web-monitor/error';

createMonitor({ appKey: '你的 appKey', host: '监控服务地址', plugins: [errorPlugin()] }).start();`}
          </div>
        }
      />

      <Row gutter={[12, 12]} className="wm-section">
        <Col xs={24} xl={14}>
          <Card size="small" title="包清单">
            <Table
              size="small"
              rowKey="name"
              pagination={false}
              dataSource={PACKAGES}
              columns={[
                {
                  title: '包名',
                  dataIndex: 'name',
                  width: 220,
                  render: (name: string) => <Typography.Text code>{name}</Typography.Text>,
                },
                { title: '职责', dataIndex: 'desc' },
                {
                  title: '必装',
                  dataIndex: 'required',
                  width: 80,
                  align: 'center',
                  render: (required: boolean) =>
                    required ? (
                      <CheckCircleTwoTone twoToneColor="#52c41a" />
                    ) : (
                      <CloseCircleOutlined style={{ color: '#c9cdd4' }} />
                    ),
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card size="small" title="按需组合矩阵">
            <Table
              size="small"
              rowKey="scene"
              pagination={false}
              dataSource={MATRIX}
              columns={[
                { title: '场景', dataIndex: 'scene', width: 200 },
                {
                  title: '需要安装的包',
                  dataIndex: 'packages',
                  render: (list: string[]) => list.map((item) => <Tag key={item}>{item}</Tag>),
                },
                { title: '体积', dataIndex: 'size', width: 110, align: 'right' },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]} className="wm-section">
        <Col xs={24} xl={12}>
          <Card size="small" title="React 接入">
            <div className="wm-code-block">
              {`import { MonitorProvider } from '@web-monitor/react';
import { MonitorErrorBoundary } from '@web-monitor/react';

<MonitorProvider options={{ appKey, host, plugins: [...] }}>
  <MonitorErrorBoundary fallback={<div>页面异常，已自动上报</div>}>
    <App />
  </MonitorErrorBoundary>
</MonitorProvider>

// 业务组件内埋点
const track = useTrack();
track('add_to_cart', { sku: 'A100', price: 99 });`}
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title="Vue 3 接入">
            <div className="wm-code-block">
              {`import { createWebMonitorPlugin, installRouterTracking } from '@web-monitor/vue';

const monitor = createWebMonitorPlugin({
  appKey,
  host,
  plugins: [performancePlugin(), errorPlugin(), behaviorPlugin()],
});

app.use(monitor);
installRouterTracking(router, monitor.instance);

// 组合式 API
const track = useTrack();
track('pay_click', { channel: 'wechat' });`}
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]} className="wm-section">
        <Col xs={24} xl={12}>
          <Card size="small" title="问题溯源的关键配置">
            <div className="wm-code-block">
              {`errorPlugin({
  // 错误发生前记录多少条用户操作（溯源核心）
  maxBreadcrumbs: 30,
  // 是否携带现场快照（内存/网络/最近请求）
  snapshot: true,
  // 只上报 warning 及以上
  minLevel: 'warning',
  // 业务错误码识别：HTTP 200 但 code !== 0 也算失败
  businessCodeExtractor: (data) => data?.code,
  ignoreErrors: [/ResizeObserver loop/],
})`}
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title="回放的成本控制">
            <div className="wm-code-block">
              {`replayPlugin({
  // 录制采样率：回放数据量远大于埋点，务必降采样
  sampleRate: 0.05,
  // 分片时长：越小越实时，越大请求越少
  flushInterval: 10000,
  // 全量遮罩输入框（默认开启）
  maskAllInputs: true,
  // 自定义遮罩 / 忽略区域
  maskSelectors: ['.user-phone'],
  blockSelectors: ['.ad-banner'],
  // 关闭鼠标轨迹可显著降低体积
  recordMouseMove: false,
})`}
            </div>
          </Card>
        </Col>
      </Row>

      <Card size="small" title="常见问题">
        <Typography.Paragraph>
          <b>1. 为什么错误堆栈只显示 “Script error.”？</b>
          <br />
          跨域脚本默认拿不到错误详情。请在 <code>script</code> 标签上添加 <code>crossorigin</code>{' '}
          属性，并确保 CDN 返回 <code>Access-Control-Allow-Origin</code> 响应头。
        </Typography.Paragraph>
        <Typography.Paragraph>
          <b>2. 如何让错误定位到源码行？</b>
          <br />
          在应用管理页面上传对应版本的 <code>.map</code> 文件（文件名与构建产物一致，不带 .map
          后缀），服务端会自动按堆栈中的文件 basename 匹配并还原源码位置与上下文。
        </Typography.Paragraph>
        <Typography.Paragraph>
          <b>3. 上报量太大怎么办？</b>
          <br />
          三层控流：全局 <code>sampleRate</code> → 能力包级 <code>sampleRate</code> → 事件级采样。
          优先降低 <code>behavior</code> 与 <code>replay</code> 的采样率；错误类数据建议保持 100% 上报。
        </Typography.Paragraph>
        <Typography.Paragraph>
          <b>4. 如何避免监控拖慢业务？</b>
          <br />
          SDK 内所有采集逻辑均做了异常隔离与空闲调度；上报走异步批量；单次请求体积受 64KB
          上限保护；页面卸载时使用 <code>sendBeacon</code> 保证数据不丢。
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
