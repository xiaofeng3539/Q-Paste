import { matchShortcut } from "../../../../../src/lib/shortcuts";

export type DeleteShortcutAction = "request-confirmation" | "confirm-delete";

export function getDeleteShortcutAction(
  event: KeyboardEvent,
  shortcut: string,
  confirmationOpen: boolean,
  editing: boolean,
): DeleteShortcutAction | null {
  if (editing || event.repeat || !matchShortcut(event, shortcut)) return null;
  return confirmationOpen ? "confirm-delete" : "request-confirmation";
}
