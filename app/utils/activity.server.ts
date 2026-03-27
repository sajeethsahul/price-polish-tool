import prisma from "../db.server";

export async function logActivity(shop: string, action: string, meta?: any) {
  try {
    await prisma.activityLog.create({
      data: {
        shop,
        action,
        meta: meta || undefined,
      },
    });
  } catch (error) {
    console.error("Failed to log activity:", error);
  }
}
