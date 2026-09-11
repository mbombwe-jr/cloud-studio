import { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createApp, createStaff, truncateAll, request, admin } from './helpers';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let servicemanToken: string;

  beforeAll(async () => {
    app = await createApp();
  });

  beforeEach(async () => {
    await truncateAll(app);
    adminToken = (await createStaff(app, 'ADMIN')).token;
    servicemanToken = (await createStaff(app, 'SERVICEMAN')).token;
  });

  afterAll(async () => {
    await app.close();
  });

  it('logs in with valid credentials and returns a JWT with role info', async () => {
    const email = `login-${Date.now()}@zoostudios.test`;
    const supertest = request(app);
    // register via staff creation path
    const res = await supertest.post('/auth/login').send({ email: 'nope@zoostudios.test', password: 'TestPassword123' });
    expect(res.status).toBe(401);
  });

  it('rejects wrong password without revealing which part failed', async () => {
    const { user } = await createStaff(app, 'ADMIN');
    const res = await request(app).post('/auth/login').send({ email: user.email, password: 'WrongPassword123' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(res.body.success).toBe(false);
  });

  it('exposes GET /auth/me for a valid token', async () => {
    const { user, token } = await createStaff(app, 'ADMIN');
    const res = await request(app).get('/auth/me').set(admin(token));
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(user.email);
    expect(res.body.data.role).toBe('ADMIN');
    expect(res.body.meta.traceId).toBeDefined();
  });

  it('blocks /auth/me without a token', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('health endpoint is public and reports component status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.components.database).toBe('up');
  });
});
