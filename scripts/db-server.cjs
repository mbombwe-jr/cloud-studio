/**
 * Zoostudios — Embedded PostgreSQL bootstrap (no root required).
 * Uses the binaries shipped with `embedded-postgres` npm package directly
 * via pg_ctl (daemonized), so the server persists across script exits.
 *
 * Usage:
 *   node scripts/db-server.cjs start   -> init (if needed) + start + create DBs
 *   node scripts/db-server.cjs stop    -> stop server
 *   node scripts/db-server.cjs status  -> is server running?
 */
const path = require('path');
const fs = require('fs');
const { execFileSync, execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = process.env.PGDATA_DIR || path.join(ROOT, '.pgdata');
const LOG_FILE = path.join(ROOT, 'scripts', 'postgres.log');
const PORT = parseInt(process.env.PG_PORT || '5433', 10);
const USER = process.env.PG_USER || 'postgres';
const PASSWORD = process.env.PG_PASSWORD || 'postgres';
const DATABASES = ['zoostudios', 'zoostudios_test'];
const BIN = path.join(ROOT, 'node_modules', '.pnpm', '@embedded-postgres+linux-x64@17.4.0-beta.15', 'node_modules', '@embedded-postgres', 'linux-x64', 'native', 'bin');

function isRunning() {
  try {
    const out = execFileSync(path.join(BIN, 'pg_ctl'), ['-D', DATA_DIR, 'status'], { stdio: 'pipe' }).toString();
    return /server is running/i.test(out);
  } catch {
    return false;
  }
}

async function createDatabases() {
  let Client;
  try { ({ Client } = require('pg')); } catch { ({ Client } = require(path.join(ROOT, 'node_modules', 'pg'))); }
  const client = new Client({ host: '127.0.0.1', port: PORT, user: USER, password: PASSWORD, database: 'postgres' });
  await client.connect();
  for (const dbName of DATABASES) {
    const r = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (r.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`[db-server] database "${dbName}" created`);
    }
  }
  await client.end();
}

async function main() {
  const cmd = process.argv[2] || 'start';
  if (cmd === 'status') { console.log(isRunning() ? 'running' : 'stopped'); return; }

  if (cmd === 'stop') {
    if (isRunning()) {
      execFileSync(path.join(BIN, 'pg_ctl'), ['-D', DATA_DIR, 'stop', '-m', 'fast']);
      console.log('[db-server] stopped');
    } else console.log('[db-server] not running');
    return;
  }

  if (!fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'))) {
    console.log('[db-server] initialising cluster at', DATA_DIR);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'scripts', '.pwfile'), PASSWORD + '\n');
    execFileSync(path.join(BIN, 'initdb'), [
      '-D', DATA_DIR, '-U', USER,
      '--pwfile', path.join(ROOT, 'scripts', '.pwfile'),
      '--auth=md5', '--encoding=UTF8', '--locale=C',
    ], { stdio: 'inherit' });
    fs.rmSync(path.join(ROOT, 'scripts', '.pwfile'), { force: true });
  }

  if (!isRunning()) {
    execFileSync(path.join(BIN, 'pg_ctl'), ['-D', DATA_DIR, '-l', LOG_FILE, '-o', `-p ${PORT}`, 'start', '-w', '-t', '60'], { stdio: 'inherit' });
  }
  console.log(`[db-server] postgres ready on 127.0.0.1:${PORT}`);
  await createDatabases();
}

main().catch((e) => { console.error('[db-server] fatal:', e.message || e); process.exit(1); });
