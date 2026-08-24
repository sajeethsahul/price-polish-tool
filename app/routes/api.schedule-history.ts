import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { applyLocaleFromSession, t } from "../utils/i18n";

export async function loader({ request }: LoaderFunctionArgs) {
    const auth = await authenticate.admin(request);
    if (auth instanceof Response) return auth;

    const { session } = auth;
    const shop = session.shop;
    applyLocaleFromSession(session);

    try {
        const jobs = await (prisma.scheduledJob as any).findMany({
            where: { shop },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                campaignId: true,
                title: true,
                runAt: true,
                mode: true,
                windowEndAt: true,
                activatedAt: true,
                restoredAt: true,
                status: true,
                productCount: true,
                products: true,
            },
        });

        return Response.json({ jobs });
    } catch (error) {
        console.error("[Schedule History API] Error fetching jobs:", error);
        return Response.json({ error: t("server.scheduleHistoryFailed") }, { status: 500 });
    }    
}
