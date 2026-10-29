import type { Operation } from "../../../../packages/shared-types/auth";
export async function request<T = unknown>(operation: Operation): Promise<T> {
  const result = await window.desktop.auth(operation);
  if (!result.ok) {
    if (result.status === 401 && operation.action !== "login") window.dispatchEvent(new Event("session-expired"));
    throw new Error(result.message);
  }
  return result.data as T;
}
