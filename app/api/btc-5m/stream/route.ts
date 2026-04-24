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
        send({ type: "ping", timestamp: Date.now() })
      }, 15000)

      const cleanup = () => {
        clearInterval(interval)
        controller.close()
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