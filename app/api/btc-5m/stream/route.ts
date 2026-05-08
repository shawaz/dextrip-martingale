import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

export async function GET() {
  const encoder = new TextEncoder()
  
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`))
      }

      send({ type: "connected", timestamp: Date.now() })

      const interval = setInterval(() => {
        fetch("https://loving-rejoicing-production-592c.up.railway.app", { method: "HEAD", signal: AbortSignal.timeout(5000) }).catch(() => {})
        send({ type: "ping", timestamp: Date.now() })
      }, 15000)

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