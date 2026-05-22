import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * How long a job may sit in "processing" before it is assumed crashed and reset.
 * 15 minutes is generous — even worst-case Shopify API calls finish in < 5 min.
 * Using runAt as the clock reference (no updatedAt column needed).
 */
const STUCK_JOB_TIMEOUT_MINUTES = 15;

// ─── Types ────────────────────────────────────────────────────────────────────

type ClaimedJob = {
    id: string;
    shop: string;
    campaignId?: string | null;
    runAt: Date;
    status: string;
    createdAt: Date;
    products?: any;
};

// ─── Atomic job claim ─────────────────────────────────────────────────────────

/**
 * Atomically claims ONE pending due job using PostgreSQL's
 * "UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *".
 *
 * Returns the claimed job row, or null if no due pending job exists.
 *
 * WHY THIS PREVENTS DOUBLE-PROCESSING:
 *
 * Current race condition (without this fix):
 *   t=0  Instance A: SELECT jobs WHERE status='pending' → returns [job-X]
 *   t=0  Instance B: SELECT jobs WHERE status='pending' → returns [job-X]  ← same job!
 *   t=1  Instance A: starts processing job-X (Shopify API calls begin)
 *   t=1  Instance B: starts processing job-X  ← DUPLICATE EXECUTION
 *   t=60 Both write PriceHistory, both mark done — double history, double Shopify push
 *
 * With atomic claim:
 *   t=0  Instance A: UPDATE SET status='processing' WHERE id=(SELECT ... FOR UPDATE SKIP LOCKED)
 *          → PostgreSQL locks the row, UPDATE succeeds, returns job-X
 *   t=0  Instance B: same query fires concurrently
 *          → SKIP LOCKED skips the locked row → subquery returns no rows
 *          → UPDATE affects 0 rows → RETURNING is empty → claimNextJob returns null
 *          → Instance B skips this tick cleanly
 *   t=60 Only Instance A processed job-X. No double execution.
 *
 * WHY FOR UPDATE SKIP LOCKED (not just the status check):
 *   Without SKIP LOCKED, Instance B would WAIT for Instance A's transaction to commit,
 *   then re-evaluate the subquery (job now has status='processing' → no match). Correct
 *   but causes lock contention under high load. SKIP LOCKED makes B skip immediately —
 *   same correctness, zero waiting, zero deadlock risk.
 *
 * NOTE: No schema migration needed. `status` is already a plain String column;
 *       "processing" is just a new valid string value alongside "pending"/"done"/"failed".
 */
async function claimNextJob(): Promise<ClaimedJob | null> {
    const result = await prisma.$queryRaw<ClaimedJob[]>`
        UPDATE "ScheduledJob"
        SET status = 'processing'
        WHERE id = (
            SELECT id
            FROM   "ScheduledJob"
            WHERE  status = 'pending'
              AND  "runAt" <= NOW()
            ORDER  BY "runAt" ASC
            LIMIT  1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING id, shop, "campaignId", "runAt", status, "createdAt", products
    `;
    return result[0] ?? null;
}

// ─── Stuck-job recovery ───────────────────────────────────────────────────────

/**
 * Resets jobs stuck in "processing" back to "pending" so they can be retried.
 *
 * When does a job get stuck?
 *   A worker instance claims a job (sets status='processing') then crashes
 *   (OOM kill, Render deploy restart, unhandled process exit) before marking it
 *   done or failed. Without recovery, those jobs sit in "processing" forever and
 *   are never retried.
 *
 * How the timeout is calculated without an updatedAt column:
 *   runAt is the intended execution time. If a job is still "processing" and its
 *   runAt is more than STUCK_JOB_TIMEOUT_MINUTES ago, the worker that claimed it
 *   is long gone. Safe to reset.
 */
async function recoverStuckJobs(): Promise<void> {
    const cutoff = new Date(Date.now() - STUCK_JOB_TIMEOUT_MINUTES * 60 * 1000);
    const recovered = await prisma.scheduledJob.updateMany({
        where: {
            status: "processing",
            runAt: { lte: cutoff },
        },
        data: { status: "pending" },
    });
    if (recovered.count > 0) {
        console.warn(
            `[Worker] ♻️ Recovered ${recovered.count} stuck "processing" job(s) ` +
            `(runAt > ${STUCK_JOB_TIMEOUT_MINUTES}min ago) — reset to "pending" for retry`
        );
    }
}

// ─── Worker ───────────────────────────────────────────────────────────────────

let isWorkerStarted = false;

export function startWorker() {
    if (isWorkerStarted) return;
    isWorkerStarted = true;

    console.log("🚀 [Worker] Background pricing worker started (60s interval, atomic job claim via FOR UPDATE SKIP LOCKED)");

    setInterval(async () => {
        try {
            // ── Phase 0: Recover jobs orphaned by crashed workers ─────────────
            await recoverStuckJobs();

            // ── Phase 1: Claim + process all due jobs (one atomic claim per job)
            //
            // Each call to claimNextJob() issues one atomic UPDATE and returns
            // exactly the job that THIS instance claimed, or null if none remain.
            // The while-loop ensures all due jobs are drained in a single tick,
            // matching the original findMany behaviour — but now race-condition-free.
            let processedCount = 0;
            let job: ClaimedJob | null;

            while ((job = await claimNextJob()) !== null) {
                processedCount++;
                const { id: jobId, shop } = job;

                console.log(
                    `[Worker] 🔄 Claimed job ${jobId} for shop ${shop} ` +
                    `(scheduled: ${job.runAt.toISOString()})`
                );

                try {
                    // ── STEP 1: Fetch products from snapshot (or fallback) ──
                    let itemsToProcess: Array<{
                        variantId: string;
                        productId: string | null;
                        stagedPrice: number;
                        originalPrice: number;
                        isManual: boolean;
                    }> = [];
                    
                    if (job.products && Array.isArray(job.products) && job.products.length > 0) {
                        console.log(`[Worker] 📚 Job ${jobId} using snapshot products (${job.products.length})`);
                        // Use frozen snapshot from schedule creation
                        itemsToProcess = job.products.map((p: any) => ({
                            variantId: p.variantId,
                            productId: p.productId,
                            stagedPrice: Number(p.newPrice),
                            originalPrice: Number(p.oldPrice),
                            isManual: p.isManual === true
                        }));
                    } else if (job.campaignId) {
                        console.log(`[Worker] 🧭 Job ${jobId} using campaign-scoped staged fallback (campaignId=${job.campaignId})`);
                        const staged = await prisma.stagedPrice.findMany({
                            where: { shop, campaignId: job.campaignId },
                        });
                        itemsToProcess = staged.map(p => ({
                            variantId: p.variantId,
                            productId: p.productId,
                            stagedPrice: Number(p.stagedPrice),
                            originalPrice: Number(p.originalPrice),
                            isManual: p.isManual === true
                        }));
                    } else {
                        console.log(`[Worker] 🧩 Job ${jobId} using legacy shop-wide staged fallback`);
                        // Fallback: older jobs without snapshot read from StagedPrice
                        const staged = await prisma.stagedPrice.findMany({
                            where: { shop },
                        });
                        itemsToProcess = staged.map(p => ({
                            variantId: p.variantId,
                            productId: p.productId,
                            stagedPrice: Number(p.stagedPrice),
                            originalPrice: Number(p.originalPrice),
                            isManual: false
                        }));
                    }

                    if (!itemsToProcess.length) {
                        console.warn(
                            `[Worker] ⚠️ No products found for job ${jobId}. ` +
                            `Marking failed.`
                        );
                        await prisma.scheduledJob.update({
                            where: { id: jobId },
                            data: { status: "failed" },
                        });
                        continue;
                    }

                    console.log(`[Worker] 📦 ${itemsToProcess.length} price(s) found for job ${jobId}`);

                    // ── STEP 2: Get Shopify admin client (offline token) ───────
                    const { admin } = await unauthenticated.admin(shop);

                    const batchId = `batch_${Date.now()}`;
                    let successCount = 0;
                    let failCount = 0;
                    const failedVariants: string[] = [];

                    // ── STEP 3: Push each variant price to Shopify ────────────
                    for (const item of itemsToProcess) {
                        try {
                            const price = Number(item.stagedPrice);

                            if (!price || isNaN(price) || price <= 0) {
                                console.error(
                                    `[Worker] ❌ Invalid price (${item.stagedPrice}) for variant ${item.variantId} — skipping`
                                );
                                failCount++;
                                failedVariants.push(item.variantId);
                                continue;
                            }

                            // Normalise GID format (matches push-storefront pattern)
                            const productId = item.productId?.startsWith("gid://")
                                ? item.productId
                                : `gid://shopify/Product/${item.productId}`;

                            const variantId = item.variantId.startsWith("gid://")
                                ? item.variantId
                                : `gid://shopify/ProductVariant/${item.variantId}`;

                            const response = await admin.graphql(
                                `mutation productVariantsBulkUpdate(
                                    $productId: ID!,
                                    $variants: [ProductVariantsBulkInput!]!
                                ) {
                                    productVariantsBulkUpdate(
                                        productId: $productId,
                                        variants: $variants
                                    ) {
                                        productVariants { id price }
                                        userErrors { field message }
                                    }
                                }`,
                                {
                                    variables: {
                                        productId,
                                        variants: [{ id: variantId, price: String(price) }],
                                    },
                                }
                            );

                            const result = await response.json();
                            const userErrors = result?.data?.productVariantsBulkUpdate?.userErrors;

                            if (userErrors?.length) {
                                console.error(
                                    `[Worker] ❌ Shopify userError for variant ${item.variantId}:`,
                                    userErrors
                                );
                                failCount++;
                                failedVariants.push(item.variantId);
                                continue;
                            }

                            // Write PriceHistory only AFTER Shopify confirms success
                            await prisma.priceHistory.create({
                                data: {
                                    shop,
                                    campaignId: job.campaignId ?? undefined,
                                    productId: item.productId,
                                    variantId: item.variantId,
                                    oldPrice: item.originalPrice,
                                    newPrice: item.stagedPrice,
                                    isManual: item.isManual === true,
                                    batchId,
                                },
                            });

                            successCount++;
                            console.log(`[Worker] ✅ Variant ${item.variantId} updated → $${price}`);

                        } catch (variantErr) {
                            console.error(
                                `[Worker] ❌ Unexpected error for variant ${item.variantId}:`,
                                variantErr
                            );
                            failCount++;
                            failedVariants.push(item.variantId);
                        }
                    }

                    // ── STEP 4: Mark app live (only if something actually published) ─
                    if (successCount > 0) {
                        await prisma.appState.upsert({
                            where: { shop },
                            update: { isLive: true },
                            create: { shop, isLive: true },
                        });

                        if (job.campaignId) {
                            const nextCampaignStatus = failCount > 0 ? "partial" : "active";
                            await prisma.campaign.updateMany({
                                where: { id: job.campaignId, shop },
                                data: { status: nextCampaignStatus },
                            });
                            console.log("[Worker] 🏷️ Campaign status transitioned", {
                                campaignId: job.campaignId,
                                status: nextCampaignStatus,
                            });
                        }
                    }

                    // ── STEP 5: Mark job done (processing → done) ─────────────
                    await prisma.scheduledJob.update({
                        where: { id: jobId },
                        data: { status: "done" },
                    });

                    console.log(
                        `[Worker] 🏁 Job ${jobId} complete — success: ${successCount}, failed: ${failCount}`
                    );

                    if (failedVariants.length > 0) {
                        console.warn(`[Worker] ⚠️ Failed variants for job ${jobId}:`, failedVariants);
                    }

                } catch (jobError) {
                    // Unhandled error mid-job → mark failed (processing → failed)
                    console.error(`[Worker] ❌ Job ${jobId} threw an unhandled error:`, jobError);
                    await prisma.scheduledJob.update({
                        where: { id: jobId },
                        data: { status: "failed" },
                    });
                }
            } // end while

            if (processedCount > 0) {
                console.log(`[Worker] ✅ Tick complete — processed ${processedCount} job(s)`);
            }

        } catch (err) {
            console.error("[Worker] ❌ Worker tick error (DB or setup issue):", err);
        }
    }, 60_000);
}
