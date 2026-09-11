import 'reflect-metadata';
import { NestFactory, Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { TraceInterceptor } from './common/interceptors/trace.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { IiiTracingService } from './iii/tracing.service';
import { IiiLoggerService } from './iii/logger.service';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import helmet from 'helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** Hard cap on JSON body size — first-line DoS defence for oversized payloads. */
const BODY_LIMIT = '256kb';
/** Hard socket/request timeout (ms) — slowloris-style exhaustion protection. */
const REQUEST_TIMEOUT_MS = 30_000;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService);
  const tracing = app.get(IiiTracingService);
  const logger = app.get(IiiLoggerService);

  // security headers (strict set; no referrer leakage, no framing, no sniffing)
  app.use(
    helmet({
      contentSecurityPolicy: false, // API-only server; the /docs page needs inline scripts
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.get('nodeEnv') === 'production' ? { maxAge: 15552000 } : false,
    }),
  );

  // payload caps + socket timeouts (DoS / slowloris mitigation)
  app.use(json({ limit: BODY_LIMIT }));
  app.use(urlencoded({ extended: false, limit: BODY_LIMIT }));
  app.use((req: Request, res: Response, next: NextFunction) => {
    req.setTimeout(REQUEST_TIMEOUT_MS);
    res.setTimeout(REQUEST_TIMEOUT_MS);
    next();
  });

  app.enableCors({
    origin: config.get('corsOrigins'),
    credentials: true,
    maxAge: 600,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });

  // global validation: reject unknown/missing fields early (secure-first)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // tracing + response envelope + uniform errors
  app.useGlobalInterceptors(new TraceInterceptor(tracing), new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // OpenAPI docs (internal tooling)
  const swagger = new DocumentBuilder()
    .setTitle('Zoostudios API')
    .setDescription(
      'Cloud services provisioning: money collection, money disbursement (single & batch), deposits, wallet transfers, settlements, SMS. ' +
        'Account endpoints authenticate with the X-API-Key header; staff endpoints use Bearer JWT.',
    )
    .setVersion('2.0')
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header', description: 'Account API key (min 32 chars)' }, 'apiKey')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Staff JWT (admin / serviceman)' }, 'bearer')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  const port = config.get<number>('port', 3000);
  await app.listen(port);
  logger.info(`zoostudios backend listening on :${port}`, { module: 'bootstrap', port, env: config.get('nodeEnv') });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal bootstrap error', err);
  process.exit(1);
});
