import type { ThemePreference } from "../../../../../packages/shared-types/ipc/desktop";

export function isTheme(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

export function isTrustedURL(candidate: string, expected: string): boolean {
  try {
    const url = new URL(candidate);
    const target = new URL(expected);
    return (
      url.origin === target.origin &&
      url.protocol === target.protocol &&
      url.host === target.host &&
      url.pathname === target.pathname &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
