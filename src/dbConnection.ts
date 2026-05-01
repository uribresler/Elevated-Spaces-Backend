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

const pool = new pg.Pool({
  connectionString: rawDbUrl || undefined,
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter });
export default prisma;