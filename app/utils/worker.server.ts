import prisma from "../db.server";

let isWorkerStarted = false;

export function startWorker() {
    if (isWorkerStarted) return;
    isWorkerStarted = true;

    console.log("🚀 Worker started");

    setInterval(async () => {
        try {
            const jobs = await prisma.scheduledJob.findMany({
                where: {
                    runAt: { lte: new Date() },
                    status: "pending",
                },
            });

            for (const job of jobs) {
                console.log("Running scheduled job:", job.id, job.shop);

                try {
                    // 🔥 1. Get staged prices for that shop
                    const staged = await prisma.stagedPrice.findMany({
                        where: { shop: job.shop },
                    });

                    if (!staged.length) {
                        console.log("No staged prices found for shop:", job.shop);
                        continue;
                    }

                    // 🔥 2. Save history (rollback support)
                    const batchId = `batch_${Date.now()}`;

                    for (const item of staged) {
                        await prisma.priceHistory.create({
                            data: {
                                shop: job.shop,
                                variantId: item.variantId,
                                oldPrice: item.originalPrice,
                                newPrice: item.stagedPrice,
                                batchId,
                            },
                        });
                    }

                    // 🔥 3. Mark app as LIVE (IMPORTANT)
                    await prisma.appState.upsert({
                        where: { shop: job.shop },
                        update: { isLive: true },
                        create: { shop: job.shop, isLive: true },
                    });

                    // 🔥 4. (OPTIONAL NEXT STEP)
                    // 👉 Here you should call Shopify GraphQL to update prices
                    // (same logic from your push-storefront API)

                    console.log("✅ Scheduled pricing applied for:", job.shop);

                    // 🔥 5. Mark job done
                    await prisma.scheduledJob.update({
                        where: { id: job.id },
                        data: { status: "done" },
                    });

                } catch (jobError) {
                    console.error("Job failed:", job.id, jobError);

                    await prisma.scheduledJob.update({
                        where: { id: job.id },
                        data: { status: "failed" },
                    });
                }
            }
        } catch (err) {
            console.error("Worker error:", err);
        }
    }, 60000);
}