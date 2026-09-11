import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { AllExceptionsFilter } from '../src/common/filters/http-exception.filter';
import { TraceInterceptor } from '../src/common/interceptors/trace.interceptor';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { IiiTracingService } from '../src/iii/tracing.service';
import { AppModule } from '../src/app.module';
import { MockCollectionProvider, MockPayoutProvider, MockSmsProvider } from '../src/providers/mock.providers';
import * as http from 'http';
import * as bcrypt from 'bcryptjs';
import { createServer, Server } from 'http';

export async function createApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, transformOptions: { enableImplicitConversion: true } }),
  );
  app.useGlobalInterceptors(new TraceInterceptor(app.get(IiiTracingService)), new TransformInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.init();
  return app;
}

export function prisma(app: INestApplication): PrismaService {
  return app.get(PrismaService);
}

export function mockCollection(app: INestApplication): MockCollectionProvider {
  return app.get(MockCollectionProvider);
}

export function mockPayout(app: INestApplication): MockPayoutProvider {
  return app.get(MockPayoutProvider);
}

export function mockSms(app: INestApplication): MockSmsProvider {
  return app.get(MockSmsProvider);
}

const TABLES = [
  'audit_logs', 'analytics_events', 'trace_spans', 'jobs', 'webhook_deliveries', 'webhook_endpoints',
  'bills', 'account_plans', 'plans', 'sms_messages', 'sender_names', 'payouts', 'disbursement_batches',
  'collections', 'deposits', 'wallet_transfers', 'wallet_transactions', 'wallets', 'service_permissions',
  'api_keys', 'settlement_accounts', 'fee_configs', 'accounts', 'staff_users',
];

export async function truncateAll(app: INestApplication) {
  const db = prisma(app);
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
}

let counter = 0;
export function uniqueEmail(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now()}-${counter}@zoostudios.test`;
}

export async function createStaff(app: INestApplication, role: 'ADMIN' | 'SERVICEMAN') {
  const email = uniqueEmail(role.toLowerCase());
  const passwordHash = await bcrypt.hash('TestPassword123', 4);
  const user = await prisma(app).staffUser.create({ data: { email, name: `${role} Tester`, passwordHash, role } });
  // login through the API to exercise the auth path
  const res = await request(app).post('/auth/login').send({ email, password: 'TestPassword123' });
  expect(res.status).toBe(200);
  return { user, token: res.body.data.accessToken as string };
}

export function request(app: INestApplication) {
  // lazy import to keep helper imports tidy
  const supertest = require('supertest');
  return supertest(app.getHttpServer());
}

export function admin(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export function apiKeyHeader(key: string) {
  return { 'X-API-Key': key };
}

export interface TestAccount {
  id: string;
  accountId: string;
  accountName: string;
  sourceCode: string;
  apiKey: string;
}

export async function createAccount(
  app: INestApplication,
  token: string,
  options: {
    services?: Partial<Record<'COLLECTION' | 'DISBURSEMENT' | 'SMS', { granted: boolean; meta?: any }>>;
    fundCollectionWallet?: string;
    fundDisbursementWallet?: string;
    accountName?: string;
  } = {},
): Promise<TestAccount> {
  const created = await request(app)
    .post('/admin/accounts')
    .set(admin(token))
    .send({ accountName: options.accountName ?? 'Test Merchant Ltd' });
  expect(created.status).toBe(201);
  const account = created.body.data.account;
  const apiKey = created.body.data.apiKey.apiKey as string;

  const entries = Object.entries(options.services ?? {});
  if (entries.length > 0) {
    const res = await request(app)
      .put(`/admin/accounts/${account.id}/permissions`)
      .set(admin(token))
      .send({
        permissions: entries.map(([service, cfg]) => ({ service, granted: cfg!.granted, ...(cfg!.meta ? { meta: cfg!.meta } : {}) })),
      });
    expect(res.status).toBe(200);
  }

  if (options.fundCollectionWallet) {
    const res = await request(app)
      .post(`/admin/accounts/${account.id}/wallets/COLLECTION/deposit`)
      .set(admin(token))
      .send({ amount: options.fundCollectionWallet, reason: 'test funding' });
    expect(res.status).toBe(201);
  }
  if (options.fundDisbursementWallet) {
    const res = await request(app)
      .post(`/admin/accounts/${account.id}/wallets/DISBURSEMENT/deposit`)
      .set(admin(token))
      .send({ amount: options.fundDisbursementWallet, reason: 'test funding' });
    expect(res.status).toBe(201);
  }

  return { id: account.id as string, accountId: account.accountId as string, accountName: account.accountName as string, sourceCode: account.sourceCode as string, apiKey };
}

/** Waits until `predicate` returns true (polls every 100ms, max 5s). */
export async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5000, intervalMs = 100): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return await predicate();
}

export interface CapturedWebhook {
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Tiny HTTP server that records webhook deliveries for assertions. */
export function startWebhookCapture(status = 200): Promise<{ url: string; captured: CapturedWebhook[]; close: () => void }> {
  const captured: CapturedWebhook[] = [];
  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        captured.push({ headers: req.headers, body });
        res.statusCode = status;
        res.end('ok');
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${address.port}/callback`, captured, close: () => server.close() });
    });
  });
}
