import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type ClickHouseClient } from '@clickhouse/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '../config/configuration';

/**
 * ClickHouse 访问层。
 * 统一走 JSONEachRow 格式与 query_params 参数化查询（杜绝 SQL 注入）。
 */
@Injectable()
export class ClickHouseService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ClickHouse');
  private readonly client: ClickHouseClient;
  private readonly database: string;
  private readonly config: AppConfig;

  constructor(configService: ConfigService) {
    this.config = configService.get<AppConfig>('') as unknown as AppConfig;
    this.database = this.config.clickhouse.database;
    this.client = createClient({
      url: this.config.clickhouse.url,
      username: this.config.clickhouse.username,
      password: this.config.clickhouse.password,
      database: this.config.clickhouse.database,
      clickhouse_settings: {
        date_time_input_format: 'best_effort',
        async_insert: 1,
        wait_for_async_insert: 1,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.command('SELECT 1');
      this.logger.log('ClickHouse connected');
      if (this.config.clickhouse.autoInit) await this.initSchema();
    } catch (error) {
      this.logger.error(`ClickHouse init failed: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.close();
    } catch {
      /* ignore */
    }
  }

  /** 初始化表结构（幂等，可重复执行） */
  async initSchema(): Promise<void> {
    const file = join(__dirname, 'clickhouse-schema.sql');
    const sql = readFileSync(file, 'utf-8');
    const statements = sql
      .split(';')
      .map((item) => item.trim())
      .filter((item) => item && !item.startsWith('--'));
    for (const statement of statements) {
      await this.command(statement);
    }
    this.logger.log(`ClickHouse schema ensured (${statements.length} statements)`);
  }

  /** 参数化查询，返回行数组 */
  async query<T = Record<string, any>>(sql: string, params: Record<string, unknown> = {}): Promise<T[]> {
    const result = await this.client.query({
      query: sql,
      query_params: params,
      format: 'JSONEachRow',
    });
    return (await result.json()) as T[];
  }

  /** 只取第一行（用于聚合查询） */
  async queryOne<T = Record<string, any>>(
    sql: string,
    params: Record<string, unknown> = {},
  ): Promise<T | undefined> {
    const rows = await this.query<T>(sql, params);
    return rows[0];
  }

  /** 批量写入 */
  async insert(table: string, values: Record<string, any>[]): Promise<void> {
    if (!values.length) return;
    await this.client.insert({
      table: `${this.database}.${table}`,
      values,
      format: 'JSONEachRow',
    });
  }

  /** 执行 DDL / 无返回语句 */
  async command(sql: string, params: Record<string, unknown> = {}): Promise<void> {
    await this.client.command({ query: sql, query_params: params });
  }

  getTable(name: string): string {
    return `${this.database}.${name}`;
  }

  getDatabase(): string {
    return this.database;
  }
}
