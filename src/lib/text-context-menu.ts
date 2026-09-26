export function getTextContextCopyValue(content: string, selection: string): string {
  return selection || content
}

export function supportsTextContextMenu(type: string): boolean {
  return type === 'text' || type === 'url' || type === 'html'
}

export function appendTextContextPasteValue(content: string, pasted: string): string {
  if (!content) return pasted
  if (!pasted) return content
  return `${content}\n${pasted}`
}

export function insertTextAtSelection(value: string, pasted: string, start: number, end: number): { value: string; cursor: number } {
  const nextValue = value.slice(0, start) + pasted + value.slice(end)
  return { value: nextValue, cursor: start + pasted.length }
}

export function appendRichTextPasteValue(content: string, pasted: string): string {
  const escaped = pasted
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
  return `${content}<br>${escaped}`
}
