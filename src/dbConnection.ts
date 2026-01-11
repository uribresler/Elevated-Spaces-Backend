// src/dbConnection.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL, // must exist
});

const adapter = new PrismaPg(pool);

const prisma = new PrismaClient({ adapter }); // adapter is required
export default prisma;