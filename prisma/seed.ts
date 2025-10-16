import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Minimal seed: ensure DB connectivity and create a sample ABTest (no side effects on Shopify)
  const test = await prisma.aBTest.upsert({
    where: { id: "seed-test-1" },
    update: {},
    create: {
      id: "seed-test-1",
      shop: "example.myshopify.com",
      productId: "gid://shopify/Product/1234567890",
      name: "Seed Test",
      status: "DRAFT",
      trafficSplit: 50,
    },
  });
  // eslint-disable-next-line no-console
  console.log("Seeded ABTest:", test.id);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
