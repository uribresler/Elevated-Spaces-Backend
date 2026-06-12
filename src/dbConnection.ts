// src/dbConnection.ts
import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import fs from 'fs';

// Load default .env first
dotenv.config();

// If DATABASE_URL is not present, try loading .env from repo root explicitly
if (!process.env.DATABASE_URL) {
  const envPath = path.resolve(__dirname, '..', '.env');
  dotenv.config({ path: envPath });
}

function stripQuotes(s?: string) {
  if (!s) return s;
  return s.replace(/^\"(.*)\"$/, '$1').replace(/^\'(.*)\'$/, '$1');
}

// Support alternate variable names if DATABASE_URL is not set (e.g., DIRECT_URL)
const envCandidates = [process.env.DATABASE_URL, process.env.DIRECT_URL, process.env.POSTGRES_URL];
let rawDbUrl = stripQuotes(envCandidates.find(Boolean));

// Fallback: parse the .env file directly if runtime env vars are missing
if (!rawDbUrl) {
  try {
    const envPath = path.resolve(__dirname, '..', '.env');
    const envText = fs.readFileSync(envPath, 'utf8');
    const m = envText.match(/(?:^|\n)\s*(?:DATABASE_URL|DIRECT_URL)\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\n#]+))/i);
    if (m) rawDbUrl = m[1] || m[2] || (m[3] && m[3].trim());
  } catch (err) {
    // ignore file read errors
  }
}

const masked = rawDbUrl ? String(rawDbUrl).replace(/:[^:@]+@/, ':<redacted>@') : rawDbUrl;
console.log('cwd:', process.cwd(), '__dirname:', __dirname);
console.log('Resolved .env path:', path.resolve(__dirname, '..', '.env'));
console.log('DB URL (masked):', masked || 'undefined');

// Pool sizing is env-driven. Defaults are tuned for ~hundreds of concurrent
// users; raise PG_POOL_MAX if your Postgres allows more connections.
const PG_POOL_MAX = Number(process.env.PG_POOL_MAX) || 50;
const PG_POOL_MIN = Number(process.env.PG_POOL_MIN) || 0;
const PG_IDLE_TIMEOUT_MS = Number(process.env.PG_IDLE_TIMEOUT_MS) || 30_000;
const PG_CONN_TIMEOUT_MS = Number(process.env.PG_CONN_TIMEOUT_MS) || 10_000;

const pool = new pg.Pool({
  connectionString: rawDbUrl || undefined,
  max: PG_POOL_MAX,
  min: PG_POOL_MIN,
  idleTimeoutMillis: PG_IDLE_TIMEOUT_MS,
  connectionTimeoutMillis: PG_CONN_TIMEOUT_MS,
});

// Surface pool-level errors so they don't crash the process silently.
pool.on('error', (err) => {
  console.error('[PG_POOL] Unexpected pool error (idle client):', err);
});

export { pool as pgPool };

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });
export default prisma;