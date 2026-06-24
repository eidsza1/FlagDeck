import { NextResponse } from "next/server";
import { getBundle } from "@/lib/flagdeck";

export const dynamic = "force-dynamic";

// GET /api/a2ui → the current A2UI message bundle.
export async function GET() {
  return NextResponse.json(await getBundle());
}
