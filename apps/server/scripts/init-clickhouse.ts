import { createClient } from '@clickhouse/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 初始化 ClickHouse 表结构。
 * 幂等：所有语句均为 CREATE ... IF NOT EXISTS，可重复执行。
 *   pnpm db:ch
 */
async function main(): Promise<void> {
  const url = process.env.CLICKHOUSE_URL || 'http://localhost:8123';
  const username = process.env.CLICKHOUSE_USERNAME || 'default';
  const password = process.env.CLICKHOUSE_PASSWORD || '';
  const database = process.env.CLICKHOUSE_DATABASE || 'web_monitor';

  const client = createClient({ url, username, password, database: 'default' });
  const file = join(process.cwd(), 'src', 'storage', 'clickhouse-schema.sql');
  const sql = readFileSync(file, 'utf-8');
  const statements = sql
    .split(';')
    .map((item) => item.trim())
    .filter((item) => item && !item.startsWith('--'));

  for (const statement of statements) {
    await client.command({ query: statement });
  }
  await client.close();

  console.log(`[web-monitor] ClickHouse schema initialized: ${statements.length} statements -> ${database}`);
}

main().catch((error) => {
  console.error('[web-monitor] init clickhouse failed:', error);
  process.exit(1);
});
