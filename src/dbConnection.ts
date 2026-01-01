// Phase: 1 (AI Virtual Staging MVP)
// This file is part of the Phase 1 deliverables.

import 'dotenv/config';

import { PrismaClient } from '../generated/prisma/client';

import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const adapter = new PrismaPg(new pg.Pool({ connectionString: process.env.DATABASE_URL }));
const prisma = new PrismaClient({ adapter });

export default prisma;