import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export async function action({ request }: ActionFunctionArgs) {
    const auth = await authenticate.admin(request);
    if (auth instanceof Response) return auth;

    const { session } = auth;
    const shop = session.shop;

    const body = await request.json().catch(() => ({}));
    const { runAt } = body;

    if (!runAt) {
        return json({ error: "runAt required" }, { status: 400 });
    }

    // FIX 3: Validate that staged prices exist before creating the job.
    // Without this, the worker fires at runAt, finds an empty StagedPrice table,
    // and previously looped forever in "pending" state.
    const staged = await prisma.stagedPrice.findMany({
        where: { shop },
        take: 1, // only need to know if at least one row exists
    });

    if (!staged.length) {
        return json(
            {
                error: "No staged prices available. Click Apply on the dashboard before scheduling.",
            },
            { status: 400 }
        );
    }

    await prisma.scheduledJob.create({
        data: {
            shop,
            runAt: new Date(runAt),
        },
    });

    return json({ success: true });
}