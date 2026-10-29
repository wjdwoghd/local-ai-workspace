export type ThemePreference = "light" | "dark" | "system";
export interface DesktopInfo {
  version: string;
  theme: ThemePreference;
}
export interface DesktopAPI {
  agent: import('../agent').AgentAPI;
  workspace: import('../workspace').WorkspaceAPI;
  getInfo(): Promise<DesktopInfo>;
  setTheme(theme: ThemePreference): Promise<void>;
  auth(operation: import("../auth").Operation): Promise<import("../auth").Result>;
  streamChat(input: import('../chat').ChatInput, onEvent: (event: import('../chat').ChatEvent) => void): Promise<import('../auth').Result>;
  cancelChat(): Promise<void>;
  importDocument(teamId: string | null): Promise<import('../auth').Result>;
  openSource(url: string): Promise<void>;
}
