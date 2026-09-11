export default () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  timezone: process.env.TZ || 'Africa/Dar_es_Salaam',

  databaseUrl: process.env.ZOO_DATABASE_URL || '',

  jwt: {
    secret: process.env.JWT_SECRET || 'insecure-dev-secret-change-me-please-32ch',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
  },
  apiKeyPrefix: process.env.API_KEY_PREFIX || 'zs',
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
  corsOrigins: (process.env.CORS_ORIGINS || '*').split(',').map((s) => s.trim()),

  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL || '60000', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT || '120', 10),
  },

  iii: {
    /** When true the platform attaches to a running iii engine (https://iii.dev)
     *  for queues, cron, logging, analytics and tracing. */
    enabled: process.env.III_ENABLED === 'true',
    url: process.env.III_URL || 'ws://127.0.0.1:49134',
    /** Local fallback driver settings */
    queue: {
      pollIntervalMs: parseInt(process.env.QUEUE_POLL_INTERVAL_MS || '1000', 10),
      concurrency: parseInt(process.env.QUEUE_CONCURRENCY || '5', 10),
      maxAttempts: parseInt(process.env.QUEUE_MAX_ATTEMPTS || '5', 10),
    },
  },

  clickpesa: {
    baseUrl: process.env.CLICKPESA_BASE_URL || 'https://api.clickpesa.com',
    clientId: process.env.CLICKPESA_CLIENT_ID || '',
    apiKey: process.env.CLICKPESA_API_KEY || '',
    checksumKey: process.env.CLICKPESA_CHECKSUM_KEY || '',
    checksumEnabled: (process.env.CLICKPESA_CHECKSUM_ENABLED || 'true') === 'true',
    /** Provider accepts 1 payout create per merchant per 60 seconds */
    payoutMinIntervalMs: parseInt(process.env.CLICKPESA_PAYOUT_MIN_INTERVAL_MS || '61000', 10),
  },

  beem: {
    baseUrl: process.env.BEEM_SMS_BASE_URL || 'https://apisms.beem.africa',
    apiKey: process.env.BEEM_API_KEY || '',
    secretKey: process.env.BEEM_SECRET_KEY || '',
  },

  sms: {
    defaultSender: process.env.SMS_DEFAULT_SENDER || 'ZOOINFO',
    rateTzs: parseFloat(process.env.SMS_RATE_TZS || '20'),
    maxRecipientsPerRequest: parseInt(process.env.SMS_MAX_RECIPIENTS || '250', 10),
  },

  mockProviders: process.env.MOCK_PROVIDERS === 'true',

  seed: {
    adminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@zoostudios.internal',
    adminPassword: process.env.SEED_ADMIN_PASSWORD || 'ChangeMe!2025',
    adminName: process.env.SEED_ADMIN_NAME || 'Platform Admin',
  },

  /** Transactions are polled for authoritative status after this delay */
  statusPoll: {
    afterMs: parseInt(process.env.STATUS_POLL_AFTER_MS || '45000', 10),
    batchSize: parseInt(process.env.STATUS_POLL_BATCH || '50', 10),
  },
});

export type AppConfiguration = ReturnType<typeof import('./configuration').default>;
