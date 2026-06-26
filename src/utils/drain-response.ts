// Native fetch (undici) keeps the socket pinned until the response body is
// consumed or cancelled. For responses we discard without reading the body
// (e.g. we only inspect the status), drain it to release the connection.
export async function drainResponse(response: {
  bodyUsed: boolean
  body?: { cancel(): Promise<void> } | null
}): Promise<void> {
  if (!response.bodyUsed) {
    await response.body?.cancel().catch(() => undefined)
  }
}
