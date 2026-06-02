import prisma from "../db.server";

export type ShopLifecycleEvent = "install" | "reinstall" | "noop";

export async function recordShopInstall(params: { shop: string }): Promise<ShopLifecycleEvent> {
  const now = new Date();

  const existing = await prisma.shop.findUnique({
    where: { shop: params.shop },
    select: { shop: true, isInstalled: true, uninstalledAt: true },
  });

  if (!existing) {
    await prisma.shop.create({
      data: {
        shop: params.shop,
        isInstalled: true,
        installedAt: now,
        uninstalledAt: null,
      },
    });
    console.log(`[SHOP LIFECYCLE] shop=${params.shop} event=install`);
    return "install";
  }

  if (existing.isInstalled) {
    return "noop";
  }

  await prisma.$transaction(async (tx) => {
    const reinstallAt = new Date();
    const uninstalledAt = existing.uninstalledAt;

    if (uninstalledAt) {
      await tx.scheduledJob.updateMany({
        where: {
          shop: params.shop,
          status: "pending",
          runAt: { gte: uninstalledAt, lt: reinstallAt },
        },
        data: { status: "missed-during-uninstall" },
      });
    }

    await tx.shop.update({
      where: { shop: params.shop },
      data: {
        isInstalled: true,
        installedAt: reinstallAt,
        uninstalledAt: null,
      },
    });
  });

  console.log(`[SHOP LIFECYCLE] shop=${params.shop} event=reinstall`);
  return "reinstall";
}

export async function recordShopUninstall(params: { shop: string }): Promise<void> {
  const now = new Date();

  await prisma.shop.upsert({
    where: { shop: params.shop },
    create: {
      shop: params.shop,
      isInstalled: false,
      installedAt: now,
      uninstalledAt: now,
    },
    update: {
      isInstalled: false,
      uninstalledAt: now,
    },
  });

  console.log(`[SHOP LIFECYCLE] shop=${params.shop} event=uninstall`);
}

export async function isShopInstalled(shop: string): Promise<boolean> {
  const record = await prisma.shop.findUnique({
    where: { shop },
    select: { isInstalled: true },
  });

  return record?.isInstalled ?? true;
}

