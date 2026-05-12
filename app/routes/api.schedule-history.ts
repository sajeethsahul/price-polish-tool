import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
    const auth = await authenticate.admin(request);
    if (auth instanceof Response) return auth;

    const { session } = auth;
    const shop = session.shop;

    try {
        const jobs = await prisma.scheduledJob.findMany({
            where: { shop },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                title: true,
                runAt: true,
                status: true,
                productCount: true,
                products: true,
            },
        });

        return json({ jobs });
    } catch (error) {
        console.error("[Schedule History API] Error fetching jobs:", error);
        return json({ error: "Failed to load schedule history" }, { status: 500 });
    }    
}
