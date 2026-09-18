import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { map, type Observable } from 'rxjs';
import type { ApiResponse } from '@web-monitor/types';

/**
 * SSE 端点跳过统一包装的元数据标记。
 * @Sse 产生的 MessageEvent 帧若被包装进 { code, data }，事件类型（event: xxx）会丢失，
 * 客户端将收不到任何具名事件——SSE 控制器必须以 @SseResponse() 打标。
 */
export const SSE_RESPONSE_KEY = 'sse-response';
export const SseResponse = () => SetMetadata(SSE_RESPONSE_KEY, true);

/** 业务错误码 */
export const BizCode = {
  OK: 0,
  INVALID_APP_KEY: 40001,
  RATE_LIMITED: 42901,
  INTERNAL: 50000,
} as const;

/**
 * 统一响应包装：{ code, message, data }
 * 上报接口的响应结构由 SDK 解析（code !== 0 视为失败并触发重试）。
 */
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    // SSE 帧直接透传（包装会破坏 event 类型与帧结构，见 SSE_RESPONSE_KEY 注释）
    const isSse = this.reflector.getAllAndOverride<boolean>(SSE_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isSse) return next.handle() as unknown as Observable<ApiResponse<T>>;
    return next.handle().pipe(
      map((data) => {
        // 已是标准结构则直接透传（便于个别接口自定义 code）
        if (data && typeof data === 'object' && 'code' in (data as object) && 'data' in (data as object)) {
          return data as unknown as ApiResponse<T>;
        }
        return { code: BizCode.OK, message: 'ok', data } as ApiResponse<T>;
      }),
    );
  }
}

/** 全局异常处理：保证任何异常也返回标准结构，且不泄露堆栈 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: number = BizCode.INTERNAL;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message as string) || exception.message;
      if (Array.isArray(message)) message = message.join('; ');
      if (typeof body === 'object' && body !== null && typeof (body as { code?: unknown }).code === 'string') {
        // 契约字符串错误码（如 REALTIME_APP_NOT_FOUND）原样透传，不退化为数字
        code = (body as { code: unknown }).code as unknown as number;
        const retryAfter = (body as { retryAfter?: number }).retryAfter;
        if (typeof retryAfter === 'number') {
          response.setHeader('Retry-After', String(retryAfter));
        }
      } else if (status === HttpStatus.TOO_MANY_REQUESTS) code = BizCode.RATE_LIMITED;
      else if (status === HttpStatus.BAD_REQUEST) code = BizCode.INVALID_APP_KEY;
      else if (status < 500) code = status;
    } else if (exception instanceof Error) {
      message = exception.message;
      this.logger.error(`${request.method} ${request.url} -> ${message}`, exception.stack);
    }

    if (status >= 500) {
      this.logger.error(`${request.method} ${request.url}`, (exception as Error)?.stack);
    }

    response.status(status).json({ code, message, data: null });
  }
}
