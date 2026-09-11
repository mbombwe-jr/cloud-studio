import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

/**
 * Seeds the platform with:
 *  - the first ADMIN login (credentials from SEED_ADMIN_* env),
 *  - the platform-wide SHARED sender name (SMS_DEFAULT_SENDER env),
 *  - a sample plan to get billing started.
 * Run: npm run db:seed  (idempotent)
 */
const prisma = new PrismaClient();

async function main() {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@zoostudios.internal').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe!2025';
  const name = process.env.SEED_ADMIN_NAME || 'Platform Admin';

  const rounds = parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
  const existing = await prisma.staffUser.findUnique({ where: { email } });
  if (!existing) {
    await prisma.staffUser.create({
      data: { email, name, role: 'ADMIN', passwordHash: await bcrypt.hash(password, rounds) },
    });
    console.log(`[seed] admin created: ${email}`);
  } else {
    console.log(`[seed] admin already exists: ${email}`);
  }

  const sender = (process.env.SMS_DEFAULT_SENDER || 'ZOOINFO').toUpperCase();
  const shared = await prisma.senderName.findFirst({ where: { accountId: null, name: sender } });
  if (!shared) {
    await prisma.senderName.create({ data: { accountId: null, name: sender, type: 'SHARED' } });
    console.log(`[seed] shared sender name created: ${sender}`);
  }

  const planName = 'Starter TZ';
  const plan = await prisma.plan.findUnique({ where: { name: planName } });
  if (!plan) {
    await prisma.plan.create({
      data: {
        name: planName,
        description: 'Entry plan: money collection + SMS (30 days)',
        services: ['COLLECTION', 'SMS'],
        recurringAmount: 75000,
        periodDays: 30,
      },
    });
    console.log(`[seed] plan created: ${planName}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
