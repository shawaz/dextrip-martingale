import { NextResponse } from "next/server"
import { fetchPolymarketSharePrice } from "@/lib/trading/polymarket"

export const dynamic = "force-dynamic"

export async function GET() {
  const encoder = new TextEncoder()
  
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: any) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)) } catch {}
      }

      send({ type: "connected", timestamp: Date.now() })

      const pushPrices = async () => {
        const now = new Date()
        const intervalS = 300
        const currentTs = Math.floor(now.getTime() / 1000)
        const windowTs = currentTs - (currentTs % intervalS)
        const pmSlug = `btc-updown-5m-${windowTs}`
        const [up, down] = await Promise.all([
          fetchPolymarketSharePrice(pmSlug, "UP").catch(() => null),
          fetchPolymarketSharePrice(pmSlug, "DOWN").catch(() => null),
        ])
        send({ type: "update", data: { polymarketPrices: { up, down } }, timestamp: Date.now() })
      }

      const interval = setInterval(() => {
        fetch("https://loving-rejoicing-production-592c.up.railway.app", { method: "HEAD", signal: AbortSignal.timeout(5000) }).catch(() => {})
        pushPrices().catch(() => {})
        send({ type: "ping", timestamp: Date.now() })
      }, 15000)

      pushPrices().catch(() => {})

      const cleanup = () => {
        clearInterval(interval)
        try { controller.close() } catch {}
      }

      global.sseCleanup = cleanup
      global.sseSend = send
    },
    cancel() {
      if (global.sseCleanup) {
        global.sseCleanup()
        global.sseCleanup = null
        global.sseSend = null
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  })
}