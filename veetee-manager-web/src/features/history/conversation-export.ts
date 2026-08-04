export interface ConversationDownloadContext {
  documentRef: Pick<Document, 'createElement' | 'body'>
  urlApi: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>
}

export function downloadJsonFile(value: unknown, filename: string, context: ConversationDownloadContext = { documentRef: document, urlApi: URL }): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = context.urlApi.createObjectURL(blob)
  const anchor = context.documentRef.createElement('a')
  anchor.href = url
  anchor.download = filename
  context.documentRef.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  context.urlApi.revokeObjectURL(url)
}
