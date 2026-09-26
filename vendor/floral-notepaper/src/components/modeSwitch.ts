export async function saveBeforeModeSwitch(
  save: (force: boolean) => Promise<boolean>,
  getState: () => string,
): Promise<boolean> {
  const state = getState();
  if (state === "dirty" || state === "saving" || state === "error") {
    if (!(await save(state === "error"))) return false;
  }
  return getState() === "saved" || getState() === "idle";
}
