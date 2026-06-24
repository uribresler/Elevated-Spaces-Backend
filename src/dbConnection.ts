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

// Pool sizing is env-driven.
//
// Connect via Supabase's TRANSACTION-mode pooler (DATABASE_URL host ending in
// `pooler.supabase.com` on port **6543**). Transaction mode multiplexes
// hundreds of clients onto a smaller backend pool, so this Node process can
// safely keep ~25 connections open without exhausting the upstream cap.
// Caveat: transaction mode disables session-scoped features like
// LISTEN/NOTIFY and `SET LOCAL`; this codebase uses neither, so the switch
// is safe.
//
// On the OLD session-mode pooler (port 5432) the upstream limit was 15 client
// connections — going above that produced EMAXCONNSESSION rejects under load.
// We warn at startup if the URL still points at 5432 so this doesn't get
// missed during the Pro upgrade.
const usingSessionModePooler =
  typeof rawDbUrl === "string" && rawDbUrl.includes("pooler.supabase.com:5432");
if (usingSessionModePooler) {
  console.warn(
    "[PG_POOL] DATABASE_URL points at the session-mode pooler (port 5432). " +
      "Switch to the transaction-mode pooler (port 6543) to unlock the higher " +
      "PG_POOL_MAX configured below — see dbConnection.ts comments."
  );
}

const DEFAULT_POOL_MAX = usingSessionModePooler ? 8 : 25;
const PG_POOL_MAX = Number(process.env.PG_POOL_MAX) || DEFAULT_POOL_MAX;
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