let guard: () => Promise<boolean> = async () => true;
export function setWorkspaceGuard(next: () => Promise<boolean>) { guard = next; }
export function confirmWorkspaceLeave() { return guard(); }
