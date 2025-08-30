import { PrismaClient } from "@prisma/client";

declare global {
  var prismaGlobal: PrismaClient;
}

if (process.env.NODE_ENV !== "production") {
  if (!global.prismaGlobal) {
    global.prismaGlobal = new PrismaClient();
  }
  // If the Prisma schema changed during dev (e.g., new models), the cached client
  // may not expose new delegates. Refresh the client when delegates are missing.
  if (!(global.prismaGlobal as any).metricEvent) {
    try {
      global.prismaGlobal.$disconnect().catch(() => {});
    } catch {}
    global.prismaGlobal = new PrismaClient();
  }
}

const prisma = global.prismaGlobal ?? new PrismaClient();

export default prisma;
