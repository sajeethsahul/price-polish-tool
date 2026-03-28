import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const records = await prisma.priceHistory.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
  });
  console.log(JSON.stringify(records, (key, value) =>
    typeof value === 'bigint' ? value.toString() : value, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
