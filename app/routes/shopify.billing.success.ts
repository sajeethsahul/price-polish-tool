import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const url = new URL(request.url);

    const shop = url.searchParams.get("shop");
    const host = url.searchParams.get("host");

    // 🔥 REDIRECT BACK TO APP
    return new Response(null, {
        status: 302,
        headers: {
            Location: `/app?shop=${shop}&host=${host}&embedded=1`,
        },
    });
};