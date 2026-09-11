import * as path from 'path';
import { execSync } from 'child_process';

/**
 * Jest global setup: pushes the Prisma schema to the dedicated test database
 * (zoostudios_test) before the suite runs.
 */
export default async function globalSetup() {
  const root = path.join(__dirname, '..');
  const url = process.env.ZOO_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5433/zoostudios_test?schema=public';
  execSync(`npx prisma db push --skip-generate --accept-data-loss`, {
    cwd: root,
    env: { ...process.env, ZOO_DATABASE_URL: url },
    stdio: 'inherit',
  });
}
