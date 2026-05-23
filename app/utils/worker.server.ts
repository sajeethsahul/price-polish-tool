import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { revertCampaignPrices } from "./revert.server";
import { isWindowExpired } from "./window-lifecycle";

// ─── Configuration ────────────────────────────────────────────────────────────

/**
 * How long a job may sit in "processing" before it is assumed crashed and reset.
 * 15 minutes is generous — even worst-case Shopify API calls finish in < 5 min.
 * Using runAt as the clock reference (no updatedAt column needed).
 */
const STUCK_JOB_TIMEOUT_MINUTES = 15;
const PUBLISH_TIMEOUT_MS = 90 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

type ClaimedJob = {
    id: string;
    shop: string;
    campaignId?: string | null;
    runAt: Date;
    mode?: string | null;
    windowEndAt?: Date | null;
    status: string;
    createdAt: Date;
    products?: any;
};

async function failOneTimePublish(
    shop: string,
    campaignId: string | null | undefined,
    jobId: string,
    reason: string
) {
    await prisma.$transaction([
        (prisma.scheduledJob as any).updateMany({
            where: {
                id: jobId,
                shop,
                mode: "one-time",
                status: { in: ["pending", "processing"] },
            },
            data: { status: "failed" },
        }),
        ...(campaignId
            ? [
                (prisma.campaign as any).updateMany({
                    where: {
                        id: campaignId,
                        shop,
                        source: "schedule",
                        status: { in: ["scheduled-publish", "publishing"] },
                    },
                    data: { status: "failed" },
                }),
                prisma.activityLog.create({
                    data: {
                        shop,
                        action: "PUBLISH_FAILED",
                        meta: {
                            campaignId,
                            jobId,
                            reason,
                        },
                    },
                }),
            ]
            : []),
    ]);
}

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
    const now = new Date();
    const result = await prisma.$queryRaw<ClaimedJob[]>`
        UPDATE "ScheduledJob"
        SET status = 'processing'
        WHERE id = (
            SELECT id
            FROM   "ScheduledJob"
            WHERE  status = 'pending'
              AND  "runAt" <= ${now}
            ORDER  BY "runAt" ASC
            LIMIT  1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING id, shop, "campaignId", "runAt", mode, "windowEndAt", status, "createdAt", products
    `;
    return result[0] ?? null;
}

async function claimExpiredWindow(): Promise<ClaimedJob | null> {
    const now = new Date();
    const result = await prisma.$queryRaw<ClaimedJob[]>`
        UPDATE "ScheduledJob" sj
        SET status = 'restoring'
        FROM (
            SELECT sj_inner.id
            FROM   "ScheduledJob" sj_inner
            JOIN   "Campaign" c
              ON   c.id = sj_inner."campaignId"
             AND   c.shop = sj_inner.shop
            WHERE  sj_inner.mode = 'time-window'
              AND  sj_inner.status = 'active-window'
              AND  sj_inner."windowEndAt" <= ${now}
              AND  sj_inner."restoredAt" IS NULL
              AND  c.source = 'schedule-window'
              AND  c.status = 'active-window'
              AND  c.status NOT IN ('window-stopped', 'auto-restored', 'cancelled-window', 'unrecoverable')
            ORDER  BY sj_inner."windowEndAt" ASC
            LIMIT  1
            FOR UPDATE SKIP LOCKED
        ) candidate
        WHERE sj.id = candidate.id
        RETURNING sj.id, sj.shop, sj."campaignId", sj."runAt", sj.mode, sj."windowEndAt", sj.status, sj."createdAt", sj.products
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
    const recoveredPublishes = await prisma.scheduledJob.updateMany({
        where: {
            status: "processing",
            runAt: { lte: cutoff },
        },
        data: { status: "pending" },
    });
    const recoveredRestores = await (prisma.scheduledJob as any).updateMany({
        where: {
            status: "restoring",
            windowEndAt: { lte: cutoff },
        },
        data: { status: "active-window" },
    });
    const recoveredCount = recoveredPublishes.count + recoveredRestores.count;
    if (recoveredCount > 0) {
        console.warn(
            `[Worker] ♻️ Recovered ${recoveredCount} stuck scheduled job(s) ` +
            `(timeout > ${STUCK_JOB_TIMEOUT_MINUTES}min) for retry`
        );
    }
}

async function failTimedOutPublishes(): Promise<void> {
    const cutoff = new Date(Date.now() - PUBLISH_TIMEOUT_MS);
    const stuckPublishes = await (prisma.campaign as any).findMany({
        where: {
            source: "schedule",
            status: "publishing",
            updatedAt: { lte: cutoff },
        },
        select: {
            id: true,
            shop: true,
            title: true,
            updatedAt: true,
        },
        take: 25,
    });

    for (const campaign of stuckPublishes) {
        const job = await (prisma.scheduledJob as any).findFirst({
            where: {
                shop: campaign.shop,
                campaignId: campaign.id,
                mode: "one-time",
                status: "processing",
            },
            orderBy: { runAt: "desc" },
            select: { id: true },
        });

        await prisma.$transaction([
            (prisma.campaign as any).updateMany({
                where: {
                    id: campaign.id,
                    shop: campaign.shop,
                    status: "publishing",
                },
                data: { status: "failed" },
            }),
            (prisma.scheduledJob as any).updateMany({
                where: {
                    shop: campaign.shop,
                    campaignId: campaign.id,
                    mode: "one-time",
                    status: "processing",
                },
                data: { status: "failed" },
            }),
            prisma.activityLog.create({
                data: {
                    shop: campaign.shop,
                    action: "PUBLISH_TIMEOUT",
                    meta: {
                        campaignId: campaign.id,
                        jobId: job?.id ?? null,
                        reason: "Publish execution timed out",
                        publishingSince: campaign.updatedAt,
                    },
                },
            }),
        ]);

        console.warn("[Worker] ⏱️ Publish execution timed out", {
            shop: campaign.shop,
            campaignId: campaign.id,
            jobId: job?.id ?? null,
            publishingSince: campaign.updatedAt,
        });
    }
}

// ─── Worker ───────────────────────────────────────────────────────────────────

let workerInterval: ReturnType<typeof setInterval> | null = null;

// Clear stale interval on Vite HMR hot-reload so the old closure (with old
// status strings) does not keep running alongside the freshly-loaded module.
if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        if (workerInterval !== null) {
            clearInterval(workerInterval);
            workerInterval = null;
            console.log("[Worker] 🔄 HMR: stale worker interval cleared");
        }
    });
}

export function startWorker() {
    if (workerInterval !== null) return;

    console.log("🚀 [Worker] Background pricing worker started (60s interval, atomic job claim via FOR UPDATE SKIP LOCKED)");

    workerInterval = setInterval(async () => {
        try {
            // ── Phase 0: Recover jobs orphaned by crashed workers ─────────────
            await recoverStuckJobs();
            await failTimedOutPublishes();

            let restoredWindowCount = 0;
            let expiredWindow: ClaimedJob | null;
            while ((expiredWindow = await claimExpiredWindow()) !== null) {
                restoredWindowCount++;
                const { id: jobId, shop, campaignId } = expiredWindow;

                console.log(
                    `[Worker] 🔁 Claimed expired pricing window ${jobId} for shop ${shop} ` +
                    `(restore: ${expiredWindow.windowEndAt?.toISOString() ?? "unknown"})`
                );

                if (!campaignId) {
                    console.warn(`[Worker] ⚠️ Window ${jobId} has no campaignId. Marking restore failed.`);
                    await prisma.scheduledJob.update({
                        where: { id: jobId },
                        data: { status: "restore-failed" },
                    });
                    continue;
                }

                try {
                    const restoreClaimedAt = new Date();
                    if (!isWindowExpired({ ...expiredWindow, source: "schedule-window" }, restoreClaimedAt)) {
                        console.warn("[Worker] ⚠️ Restore claim skipped because window end has not passed", {
                            jobId,
                            campaignId,
                            runAt: expiredWindow.runAt.toISOString(),
                            windowEndAt: expiredWindow.windowEndAt?.toISOString() ?? null,
                            now: restoreClaimedAt.toISOString(),
                        });
                        await prisma.scheduledJob.update({
                            where: { id: jobId },
                            data: { status: "restore-deferred" },
                        });
                        continue;
                    }

                    const { admin } = await unauthenticated.admin(shop);
                    const restoreResult = await revertCampaignPrices({
                        admin,
                        shop,
                        campaignId,
                        successCampaignStatus: "auto-restored",
                    });

                    const restoredCleanly =
                        restoreResult.terminal ||
                        (restoreResult.success &&
                            restoreResult.failedCount === 0 &&
                            restoreResult.unrecoverableCount === 0);

                    await (prisma.scheduledJob as any).update({
                        where: { id: jobId },
                        data: {
                            status: restoredCleanly ? "auto-restored" : "restore-failed",
                            restoredAt: new Date(),
                        },
                    });
                    if (restoredCleanly) {
                        await prisma.$transaction([
                            (prisma.campaign as any).updateMany({
                                where: {
                                    id: campaignId,
                                    shop,
                                    status: "active-window",
                                },
                                data: { status: "auto-restored" },
                            }),
                            prisma.stagedPrice.deleteMany({
                                where: {
                                    shop,
                                    campaignId,
                                },
                            }),
                        ]);
                    }
                    await prisma.activityLog.create({
                        data: {
                            shop,
                            action: "WINDOW_AUTO_RESTORED",
                            meta: {
                                campaignId,
                                jobId,
                                restoredCount: restoreResult.restoredCount,
                                failedCount: restoreResult.failedCount,
                                unrecoverableCount: restoreResult.unrecoverableCount,
                                terminal: restoreResult.terminal,
                            },
                        },
                    });

                    console.log("[Worker] 🏁 Pricing window restore complete", {
                        jobId,
                        campaignId,
                        restoredCount: restoreResult.restoredCount,
                        failedCount: restoreResult.failedCount,
                        unrecoverableCount: restoreResult.unrecoverableCount,
                        terminal: restoreResult.terminal,
                    });
                } catch (restoreError) {
                    console.error(`[Worker] ❌ Window restore failed for ${jobId}:`, restoreError);
                    await prisma.scheduledJob.update({
                        where: { id: jobId },
                        data: { status: "restore-failed" },
                    });
                }
            }

            if (restoredWindowCount > 0) {
                console.log(`[Worker] ✅ Restored ${restoredWindowCount} expired pricing window(s)`);
            }

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
                if (job.campaignId && job.mode !== "time-window") {
                    console.log("[Worker] 📌 Publish claimed", {
                        shop,
                        campaignId: job.campaignId,
                        jobId,
                        runAt: job.runAt.toISOString(),
                    });
                }

                try {
                    if (job.campaignId && job.mode !== "time-window") {
                        await (prisma.campaign as any).updateMany({
                            where: {
                                id: job.campaignId,
                                shop,
                                status: "scheduled-publish",
                            },
                            data: { status: "publishing" },
                        });
                        await prisma.activityLog.create({
                            data: {
                                shop,
                                action: "PUBLISH_STARTED",
                                meta: {
                                    campaignId: job.campaignId,
                                    jobId,
                                    runAt: job.runAt.toISOString(),
                                },
                            },
                        });
                        console.log("[Worker] 🚀 Publish started", {
                            shop,
                            campaignId: job.campaignId,
                            jobId,
                        });
                    }

                    if (
                        job.mode === "time-window" &&
                        isWindowExpired({ ...job, source: "schedule-window" }, new Date())
                    ) {
                        console.warn("[Worker] ⚠️ Skipping expired pricing window before publish", {
                            jobId,
                            campaignId: job.campaignId,
                            runAt: job.runAt.toISOString(),
                            windowEndAt: job.windowEndAt?.toISOString() ?? null,
                        });
                        await prisma.$transaction([
                            (prisma.scheduledJob as any).update({
                                where: { id: jobId },
                                data: { status: "cancelled" },
                            }),
                            ...(job.campaignId
                                ? [
                                    (prisma.campaign as any).updateMany({
                                        where: { id: job.campaignId, shop },
                                        data: { status: "cancelled-window" },
                                    }),
                                    prisma.stagedPrice.deleteMany({
                                        where: { shop, campaignId: job.campaignId },
                                    }),
                                ]
                                : []),
                        ]);
                        continue;
                    }

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
                        if (job.mode !== "time-window") {
                            await failOneTimePublish(shop, job.campaignId, jobId, "No products found to publish");
                        } else {
                            await prisma.scheduledJob.update({
                                where: { id: jobId },
                                data: { status: "failed" },
                            });
                        }
                        continue;
                    }

                    console.log(`[Worker] 📦 ${itemsToProcess.length} price(s) found for job ${jobId}`);
                    if (job.campaignId && job.mode !== "time-window") {
                        console.log("[Worker] 🧾 Pricing apply started", {
                            shop,
                            campaignId: job.campaignId,
                            jobId,
                            productCount: itemsToProcess.length,
                        });
                    }

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

                    const isTimeWindow = job.mode === "time-window";
                    if (job.campaignId && !isTimeWindow) {
                        console.log("[Worker] 🧾 Pricing apply completed", {
                            shop,
                            campaignId: job.campaignId,
                            jobId,
                            successCount,
                            failCount,
                        });
                    }

                    // ── STEP 4: Mark app live (only if something actually published) ─
                    if (successCount > 0) {
                        await prisma.appState.upsert({
                            where: { shop },
                            update: { isLive: true },
                            create: { shop, isLive: true },
                        });

                        if (job.campaignId) {
                            const nextCampaignStatus = isTimeWindow
                                ? "active-window"
                                : failCount > 0 ? "failed" : "published";
                            await prisma.campaign.updateMany({
                                where: { id: job.campaignId, shop },
                                data: { status: nextCampaignStatus },
                            });
                            if (isTimeWindow) {
                                await prisma.activityLog.create({
                                    data: {
                                        shop,
                                        action: "WINDOW_ACTIVATED",
                                        meta: {
                                            campaignId: job.campaignId,
                                            jobId,
                                            productCount: successCount,
                                            windowEndAt: job.windowEndAt?.toISOString() ?? null,
                                        },
                                    },
                                });
                            }
                            console.log("[Worker] 🏷️ Campaign status transitioned", {
                                campaignId: job.campaignId,
                                status: nextCampaignStatus,
                            });
                        }
                    }

                    // ── STEP 5: Mark job done (processing → done) ─────────────
                    await (prisma.scheduledJob as any).update({
                        where: { id: jobId },
                        data: successCount === 0
                            ? { status: "failed" }
                            : successCount > 0 && isTimeWindow
                                ? { status: "active-window", activatedAt: new Date() }
                                : { status: "done" },
                    });
                    if (successCount === 0 && job.campaignId) {
                        await failOneTimePublish(shop, job.campaignId, jobId, "No prices published successfully");
                    }
                    if (job.campaignId && !isTimeWindow) {
                        await prisma.activityLog.create({
                            data: {
                                shop,
                                action: failCount > 0 || successCount === 0 ? "PUBLISH_FAILED" : "PUBLISH_FINALIZED",
                                meta: {
                                    campaignId: job.campaignId,
                                    jobId,
                                    successCount,
                                    failCount,
                                    reason: failCount > 0 ? "One or more products failed to publish" : null,
                                },
                            },
                        });
                        console.log(failCount > 0 || successCount === 0
                            ? "[Worker] ❌ Publish failed"
                            : "[Worker] ✅ Publish finalized", {
                            shop,
                            campaignId: job.campaignId,
                            jobId,
                            successCount,
                            failCount,
                        });
                    }

                    console.log(
                        `[Worker] 🏁 Job ${jobId} complete — success: ${successCount}, failed: ${failCount}`
                    );

                    if (failedVariants.length > 0) {
                        console.warn(`[Worker] ⚠️ Failed variants for job ${jobId}:`, failedVariants);
                    }

                } catch (jobError) {
                    // Unhandled error mid-job → mark failed (processing → failed)
                    console.error(`[Worker] ❌ Job ${jobId} threw an unhandled error:`, jobError);
                    if (job.mode !== "time-window") {
                        await failOneTimePublish(
                            shop,
                            job.campaignId,
                            jobId,
                            jobError instanceof Error ? jobError.message : "Publish execution failed"
                        );
                    } else {
                        await prisma.scheduledJob.update({
                            where: { id: jobId },
                            data: { status: "failed" },
                        });
                    }
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
