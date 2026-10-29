import { describe, expect, it } from "vitest";
import { isTheme, isTrustedURL } from "../../src/main/security/policy";
import { demoReply } from "../../src/renderer/features/chat/demo";

describe("IPC 입력 및 출처 제한", () => {
  it("명시된 테마만 허용한다", () => {
    for (const value of ["light", "dark", "system"])
      expect(isTheme(value)).toBe(true);
    for (const value of [null, {}, ["dark"], "Dark", "", "../settings.json", 0])
      expect(isTheme(value)).toBe(false);
  });
  it("로컬 렌더러의 정확한 주소만 허용한다", () => {
    const local = "file:///C:/app/dist/renderer/index.html";
    expect(isTrustedURL(local, local)).toBe(true);
    for (const url of [
      "file:///C:/other/index.html",
      local + "?x=1",
      local + "#x",
      "https://example.com",
      "invalid",
    ])
      expect(isTrustedURL(url, local)).toBe(false);
    expect(
      isTrustedURL("http://127.0.0.1:5173/", "http://127.0.0.1:5173/"),
    ).toBe(true);
    expect(
      isTrustedURL("http://127.0.0.1:5174/", "http://127.0.0.1:5173/"),
    ).toBe(false);
    expect(
      isTrustedURL("http://localhost:5173/", "http://127.0.0.1:5173/"),
    ).toBe(false);
  });
});
describe("로컬 데모", () => {
  it("사용자 메시지를 코드나 HTML로 실행하지 않고 응답 문자열로 만든다", () => {
    expect(demoReply("<script>alert(1)</script>")).toContain("로컬 데모");
    expect(demoReply("오늘 계획")).toContain("데모 예시");
  });
});
