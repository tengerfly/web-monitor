import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * 初始化演示数据：
 *  - 一个可直接接入的应用（appKey 固定，便于示例工程开箱可用）
 *  - 一条「5 分钟内错误数 > 10」的示例告警规则
 *   pnpm db:seed
 */
async function main(): Promise<void> {
  const appKey = 'wm_demo00000001';

  const project = await prisma.project.upsert({
    where: { appKey },
    create: {
      appKey,
      name: '演示应用',
      description: '本地开发与示例工程使用的默认应用',
      envs: ['production', 'staging', 'development'],
      sampleRate: 1,
      plugins: { performance: true, behavior: true, error: true, replay: true },
      pluginConfig: {
        performance: {
          sampleRate: 1,
          slowApiThreshold: 1000,
          slowResourceThreshold: 500,
          thresholds: { LCP: 2500, INP: 200, CLS: 0.1, FCP: 1800, TTFB: 800 },
        },
        behavior: { sampleRate: 1, exposure: true, exposureTargets: ['.banner', '[data-track]'] },
        error: { sampleRate: 1, maxBreadcrumbs: 20, minLevel: 'warning' },
        replay: { sampleRate: 0.5, maskAllInputs: true, flushInterval: 10000 },
      },
      maskRules: {
        selectors: ['.sensitive', '[data-wm-mask]'],
        fields: ['password', 'token', 'idCard', 'mobile'],
      },
      retentionDays: 90,
    },
    update: {},
  });

  const existingRule = await prisma.alertRule.findFirst({
    where: { appKey, name: '错误激增（5 分钟 > 10 次）' },
  });
  if (!existingRule) {
    await prisma.alertRule.create({
      data: {
        appKey,
        name: '错误激增（5 分钟 > 10 次）',
        enabled: true,
        metric: 'error_count',
        operator: 'gt',
        threshold: 10,
        window: 5,
        silence: 30,
        minCount: 1,
        channels: [],
        filter: {},
      },
    });
  }

  console.log(`[web-monitor] seeded project ${project.appKey} (${project.name})`);
}

main()
  .catch((error) => {
    console.error('[web-monitor] seed failed:', error);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
