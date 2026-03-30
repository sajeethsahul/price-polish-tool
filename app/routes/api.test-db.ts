import { type LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  try {
    // 🔍 Diagnostic Query
    const result = await prisma.$queryRaw`SELECT 1`;

    return new Response(JSON.stringify({
      status: "OK",
      result,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("❌ DB Diagnostic Failed:", error);
    
    return new Response(JSON.stringify({
      status: "ERROR",
      message: error?.message,
      code: error?.code,
      stack: error?.stack,
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
