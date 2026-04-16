import prisma from "../db.server";

export async function getSubscription(shop: string) {
    return prisma.subscription.findUnique({ where: { shop } });
}

export async function saveSubscription(shop: string, chargeId?: string) {
    return prisma.subscription.upsert({
        where: { shop },
        update: {
            status: "active",
            chargeId,
        },
        create: {
            shop,
            plan: "basic",
            status: "active",
            chargeId,
        },
    });
}

export async function deleteSubscription(shop: string) {
    return prisma.subscription.deleteMany({
        where: { shop },
    });
}