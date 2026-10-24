import { PrismaClient } from '@prisma/client';

// One shared client for the whole backend.
export const prisma = new PrismaClient();
