import type { DesktopAPI } from "../../../../packages/shared-types/ipc/desktop";
declare global {
  interface Window {
    desktop: DesktopAPI;
  }
}
