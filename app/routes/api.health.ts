import type { LoaderFunctionArgs } from "react-router";
import { cors, handlePreflight } from "../utils/cors";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    return cors(new Response(JSON.stringify({ status: "OK" }), {
        headers: { "Content-Type": "application/json" },
    }));
};
