export type ThemePreference = "light" | "dark" | "system";
export interface DesktopInfo {
  version: string;
  theme: ThemePreference;
}
export interface DesktopAPI {
  getInfo(): Promise<DesktopInfo>;
  setTheme(theme: ThemePreference): Promise<void>;
  auth(operation: import("../auth").Operation): Promise<import("../auth").Result>;
}
