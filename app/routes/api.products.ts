import type { LoaderFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { cors, handlePreflight } from "../utils/cors";

export const loader = async ({ request }: LoaderFunctionArgs) => {
    const preflight = handlePreflight(request);
    if (preflight) return preflight;

    const { admin } = await authenticate.admin(request);

    const response = await admin.graphql(`
    {
      products(first: 50) {
        edges {
          node {
            id
            title
          }
        }
      }
    }
  `);

    const data = await response.json();
    const products = data.data.products.edges.map(
        (edge: { node: { id: string; title: string } }) => ({
            id: edge.node.id,
            title: edge.node.title,
        }),
    );

    return cors(new Response(JSON.stringify({ products }), {
        headers: { "Content-Type": "application/json" },
    }));
};
