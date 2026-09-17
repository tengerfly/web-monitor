import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, text, type Request, type Response, type NextFunction } from 'express';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  // 上报接口需要同时兼容 JSON（fetch）与纯文本（sendBeacon，避免 CORS 预检）
  app.use((req: Request, res: Response, next: NextFunction) => {
    const contentType = req.headers['content-type'] || '';
    if (req.path.includes('/ingest')) {
      if (contentType.includes('text/plain')) {
        return text({ type: '*/*', limit: '1mb' })(req, res, next);
      }
      return json({ limit: '1mb' })(req, res, next);
    }
    return json({ limit: '10mb' })(req, res, next);
  });

  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: (process.env.CORS_ORIGIN || '*').split(',').map((item) => item.trim()),
    credentials: false,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: false,
      forbidNonWhitelisted: false,
    }),
  );

  const port = Number(process.env.PORT || 8787);
  await app.listen(port, '0.0.0.0');
  console.log(`[web-monitor] server listening on http://127.0.0.1:${port}/api/v1`);
}

void bootstrap();
