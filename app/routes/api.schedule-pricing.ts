import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../../db.server";
import { authenticate } from "../../shopify.server";

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

    await prisma.scheduledJob.create({
        data: {
            shop,
            runAt: new Date(runAt),
        },
    });

    return json({ success: true });
}