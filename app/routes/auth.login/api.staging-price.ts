import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../../db.server";
import { authenticate } from "../../shopify.server";

export async function action({ request }: ActionFunctionArgs) {
  const auth = await authenticate.admin(request);

  if (auth instanceof Response) return auth;

  const { session, admin } = auth;
  const shop = session.shop;

  const body = await request.json().catch(() => ({}));
  const { items, applyMode, collectionId } = body;

  let finalItems = items;

  // 🔥 COLLECTION MODE
  if (applyMode === "collection") {
    if (!collectionId) {
      return json(
        { success: false, error: "Collection ID required" },
        { status: 400 }
      );
    }

    const response = await admin.graphql(`
      {
        collection(id: "gid://shopify/Collection/${collectionId}") {
          products(first: 50) {
            edges {
              node {
                variants(first: 50) {
                  edges {
                    node {
                      id
                      price
                    }
                  }
                }
              }
            }
          }
        }
      }
    `);

    const data = await response.json();

    const products =
      data?.data?.collection?.products?.edges?.flatMap((p: any) =>
        p.node.variants.edges.map((v: any) => ({
          variantId: v.node.id.split("/").pop(),
          oldPrice: parseFloat(v.node.price),
        }))
      ) || [];

    finalItems = products.map((p: any) => ({
      shop,
      variantId: p.variantId,
      stagedPrice: p.oldPrice, // safe for now
      originalPrice: p.oldPrice,
    }));
  }

  // 🔥 VALIDATION
  if (!finalItems || !Array.isArray(finalItems)) {
    return json(
      { success: false, error: "Invalid payload" },
      { status: 400 }
    );
  }

  // 🔥 SAVE TO DB
  await prisma.stagedPrice.createMany({
    data: finalItems.map((i: any) => ({
      shop,
      variantId: i.variantId,
      stagedPrice: parseFloat(i.newPrice ?? i.stagedPrice),
      originalPrice: parseFloat(i.oldPrice ?? i.originalPrice),
    })),
  });

  return json({ success: true });
}