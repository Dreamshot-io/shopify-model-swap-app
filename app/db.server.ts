import { PrismaClient } from "@prisma/client";

// Reuse Prisma client across serverless invocations to avoid exhausting DB connections
declare global {
  // eslint-disable-next-line no-var
  var prisma: PrismaClient | undefined;
}

const prisma = globalThis.prisma ?? new PrismaClient();

// In development, preserve the client across HMR; in production, cache for warm lambdas
if (process.env.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}

export default prisma;
