export type ThemePreference = "light" | "dark" | "system";
export interface DesktopInfo {
  version: string;
  theme: ThemePreference;
  mode: 'local' | 'server';
}
export interface DesktopAPI {
  copyText(text:string): Promise<void>;
  profiles(request: import('../local-profile').LocalProfileRequest): Promise<import('../local-profile').LocalProfileView>;
  git(request: import('../git').GitRequest): Promise<import('../git').GitResult>;
  agent: import('../agent').AgentAPI;
  workspace: import('../workspace').WorkspaceAPI;
  getInfo(): Promise<DesktopInfo>;
  setTheme(theme: ThemePreference): Promise<void>;
  auth(operation: import("../auth").Operation): Promise<import("../auth").Result>;
  streamChat(input: import('../chat').ChatInput, onEvent: (event: import('../chat').ChatEvent) => void): Promise<import('../auth').Result>;
  cancelChat(): Promise<void>;
  planChat(input: import('../task').TaskInput): Promise<import('../task').TaskPlan>;
  importDocument(teamId: string | null): Promise<import('../auth').Result>;
  openSource(url: string): Promise<void>;
}
