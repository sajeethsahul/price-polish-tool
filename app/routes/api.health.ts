import type { LoaderFunctionArgs } from "react-router";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    return new Response(JSON.stringify({ status: "OK" }), {
        headers: { "Content-Type": "application/json" },
    });
};
