import { NextResponse } from "next/server";
import { applyAction } from "@/lib/flagdeck";

export const dynamic = "force-dynamic";

// POST /api/action  { action, ui } → resolve userAction → apply → fresh bundle.
export async function POST(req: Request) {
  const { action, ui } = await req.json();
  const result = await applyAction(action, ui ?? {});
  return NextResponse.json(result);
}
