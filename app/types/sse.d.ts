declare global {
  var sseCleanup: (() => void) | null
  var sseSend: ((data: any) => void) | null
}

export {}