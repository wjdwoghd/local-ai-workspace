export interface TextEdit { rangeOffset: number; rangeLength: number; text: string }
// Monaco uses LF offsets. Keep existing separators outside each actual edit,
// and use the first separator in the file for newly inserted line breaks.
export function applyWorkspaceEdits(raw: string, edits: readonly TextEdit[]): string {
  const newline = raw.match(/\r\n|\r|\n/)?.[0] || '\n';
  const offset = (normalizedOffset: number) => {
    let i = 0; let n = 0;
    while (i < raw.length && n < normalizedOffset) { if (raw[i] === '\r' && raw[i + 1] === '\n') i++; i++; n++; }
    return i;
  };
  const changes = edits.map(edit => ({ start: offset(edit.rangeOffset), end: offset(edit.rangeOffset + edit.rangeLength), text: edit.text.replace(/\r\n|\r|\n/g, newline) })).sort((a, b) => b.start - a.start);
  for (const edit of changes) raw = raw.slice(0, edit.start) + edit.text + raw.slice(edit.end);
  return raw;
}
