"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const bcrypt = __importStar(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
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
    }
    else {
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
//# sourceMappingURL=seed.js.map