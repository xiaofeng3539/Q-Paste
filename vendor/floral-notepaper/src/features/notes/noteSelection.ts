export interface NoteListSelectionModifiers {
  ctrlKey: boolean;
  shiftKey: boolean;
}

export interface NoteListSelection {
  selectedIds: Set<string>;
  anchorId: string;
}

export function canStartNoteDrag(modifiers: {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): boolean {
  return !modifiers.ctrlKey && !modifiers.metaKey && !modifiers.shiftKey;
}

export function isNoteSelectedInList(
  noteId: string,
  activeNoteId: string | null,
  multiSelectedIds: ReadonlySet<string>,
  pendingSelectionId: string | null = null,
): boolean {
  if (multiSelectedIds.size > 0) return multiSelectedIds.has(noteId);
  return noteId === (pendingSelectionId ?? activeNoteId);
}

export function selectNoteFromList(
  noteIds: string[],
  selectedIds: ReadonlySet<string>,
  anchorId: string | null,
  clickedId: string,
  modifiers: NoteListSelectionModifiers,
): NoteListSelection {
  if (modifiers.shiftKey) {
    const clickedIndex = noteIds.indexOf(clickedId);
    const anchorIndex = anchorId ? noteIds.indexOf(anchorId) : -1;
    if (clickedIndex >= 0) {
      const start = anchorIndex >= 0 ? Math.min(anchorIndex, clickedIndex) : clickedIndex;
      const end = anchorIndex >= 0 ? Math.max(anchorIndex, clickedIndex) : clickedIndex;
      const nextSelection = modifiers.ctrlKey ? new Set(selectedIds) : new Set<string>();
      for (let index = start; index <= end; index += 1) {
        nextSelection.add(noteIds[index]);
      }
      return { selectedIds: nextSelection, anchorId: anchorId ?? clickedId };
    }
  }

  if (modifiers.ctrlKey) {
    const nextSelection = new Set(selectedIds);
    if (nextSelection.has(clickedId)) nextSelection.delete(clickedId);
    else nextSelection.add(clickedId);
    return { selectedIds: nextSelection, anchorId: clickedId };
  }

  return { selectedIds: new Set(), anchorId: clickedId };
}

export function selectAllNotes(noteIds: string[]): Set<string> {
  return new Set(noteIds);
}

export function getNoteDeleteTargets(
  contextNoteId: string,
  selectedIds: ReadonlySet<string>,
  orderedNoteIds: string[],
): string[] {
  if (!selectedIds.has(contextNoteId)) return [contextNoteId];
  return orderedNoteIds.filter((id) => selectedIds.has(id));
}
