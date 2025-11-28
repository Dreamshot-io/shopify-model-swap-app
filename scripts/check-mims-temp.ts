import prisma from '../app/db.server';

async function checkMims() {
  const shop = await prisma.shopCredential.findFirst({
    where: { shopDomain: 'hellomims.com' },
    select: { id: true, shopDomain: true, appUrl: true, scopes: true, status: true }
  });
  console.log('MIMS credential:', JSON.stringify(shop, null, 2));
  
  if (shop) {
    const sessions = await prisma.session.findMany({
      where: { shopId: shop.id },
      select: { id: true, shop: true, isOnline: true, expires: true }
    });
    console.log('Sessions:', JSON.stringify(sessions, null, 2));
  }
  process.exit(0);
}

checkMims();
