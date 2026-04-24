import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

const VALID_TOKEN = process.env.SSE_TRIGGER_TOKEN || "dev-token-change-me"

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization")
  
  if (auth !== `Bearer ${VALID_TOKEN}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  try {
    const body = await req.json()
    
    if (global.sseSend) {
      global.sseSend({
        type: "update",
        data: body,
        timestamp: Date.now(),
      })
      return NextResponse.json({ success: true, clients: 1 })
    }
    
    return NextResponse.json({ success: false, clients: 0 })
  } catch (e) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  }
}