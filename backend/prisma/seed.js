import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { ROLES, ROLE_DESCRIPTIONS } from '../../shared/constants/roles.js';
import { PERMISSION_INFO, DEFAULT_RBAC_MATRIX } from '../../shared/constants/permissions.js';

const prisma = new PrismaClient();

async function main() {
  // Branch
  let branch = await prisma.branch.findFirst();
  if (!branch) branch = await prisma.branch.create({ data: { name: 'Main Branch' } });

  // Permissions (remember which ones are new, so existing databases get the default grants for them)
  const newCodes = new Set();
  for (const p of PERMISSION_INFO) {
    if (!(await prisma.permission.findUnique({ where: { code: p.code } }))) newCodes.add(p.code);
    await prisma.permission.upsert({ where: { code: p.code }, update: { module: p.module, description: p.description }, create: p });
  }

  // Roles and the default matrix (only filled the first time, so edits made in the app are kept)
  for (const name of Object.values(ROLES)) {
    const existing = await prisma.role.findUnique({ where: { name } });
    if (existing) {
      // Role already there: only add default grants for permissions created in this run. Edits made in the app stay.
      for (const [code, grant] of Object.entries(DEFAULT_RBAC_MATRIX[name])) {
        if (!newCodes.has(code)) continue;
        const perm = await prisma.permission.findUnique({ where: { code } });
        await prisma.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: existing.id, permissionId: perm.id } },
          update: {},
          create: { roleId: existing.id, permissionId: perm.id, scope: grant.scope, limitValue: grant.limit },
        });
      }
      continue;
    }
    const role = await prisma.role.create({ data: { name, description: ROLE_DESCRIPTIONS[name], isSystem: true } });
    for (const [code, grant] of Object.entries(DEFAULT_RBAC_MATRIX[name])) {
      const perm = await prisma.permission.findUnique({ where: { code } });
      await prisma.rolePermission.create({
        data: { roleId: role.id, permissionId: perm.id, scope: grant.scope, limitValue: grant.limit },
      });
    }
  }

  // Demo users (development only)
  if (process.env.NODE_ENV !== 'production') {
    const password = process.env.SEED_PASSWORD || 'Passw0rd!';
    const pin = process.env.SEED_PIN || '1234';
    for (const name of Object.values(ROLES)) {
      const exists = await prisma.user.findUnique({ where: { username: name } });
      if (exists) continue;
      const role = await prisma.role.findUnique({ where: { name } });
      await prisma.user.create({
        data: {
          name: `Demo ${name}`, username: name, branchId: branch.id,
          passwordHash: await bcrypt.hash(password, 10), pinHash: await bcrypt.hash(pin, 10),
          roles: { create: [{ roleId: role.id }] },
        },
      });
    }
    console.log(`Demo users created: ${Object.values(ROLES).join(', ')} (password "${password}", PIN "${pin}")`);
  }
  console.log('Seed complete');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
