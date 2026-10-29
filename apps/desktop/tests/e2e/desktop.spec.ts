import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { authFixture, login } from "./support/auth-server";

test("채팅·설정·테마 재실행 복원과 Electron 보안", async () => {
  const profile = await mkdtemp(join(tmpdir(), "local-ai-ui-"));
  const fixture = await authFixture();
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE",
    ),
  );
  const launch = () =>
    electron.launch({
      args: [resolve(".")],
      env: {
        ...environment,
        LOCAL_AI_TEST_PROFILE: profile,
        ELECTRON_RENDERER_URL: process.env.TEST_RENDERER_URL || "",
        AUTH_SERVER_URL: fixture.url,
      },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await login(page, "alice", fixture.password);
    await expect(
      page.getByRole("heading", { name: "새로운 대화" }),
    ).toBeVisible();
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.getByRole("link", { name: "본문으로 건너뛰기" }).focus();
    await expect(
      page.getByRole("link", { name: "본문으로 건너뛰기" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
    const security = await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0]
        .webContents as unknown as {
        getLastWebPreferences(): {
          contextIsolation: boolean;
          sandbox: boolean;
          nodeIntegration: boolean;
        };
      };
      const prefs = contents.getLastWebPreferences();
      return {
        contextIsolation: prefs.contextIsolation,
        sandbox: prefs.sandbox,
        nodeIntegration: prefs.nodeIntegration,
      };
    });
    expect(security).toEqual({
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    });
    expect(
      await page.evaluate(() => ({
        node: typeof (window as unknown as { require?: unknown }).require,
        api: Object.keys(window.desktop).sort(),
      })),
    ).toEqual({ node: "undefined", api: ["auth", "getInfo", "setTheme"] });
    await expect(
      page.evaluate(() => window.desktop.setTheme("invalid" as never)),
    ).rejects.toThrow();
    await page.getByLabel("메시지 입력").fill("안녕하세요");
    await page.getByLabel("메시지 입력").press("Enter");
    await expect(page.getByRole("log")).toContainText("데모 응답");
    await expect(page.getByRole("log")).toContainText("안녕하세요!");
    await page.getByRole("button", { name: "새 대화" }).click();
    await expect(
      page.getByRole("heading", { name: "새로운 대화" }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "대화 목록" })
      .getByRole("button", { name: "안녕하세요" })
      .click();
    await expect(page.getByRole("log")).toContainText("안녕하세요!");
    await page.getByRole("button", { name: "설정", exact: true }).click();
    await expect(page.getByTestId("app-version")).toHaveText("0.1.0");
    for (const [label, value] of [
      ["라이트", "light"],
      ["시스템", "system"],
      ["다크", "dark"],
    ]) {
      await page.getByRole("radio", { name: new RegExp(label) }).click();
      await expect(
        page.getByRole("radio", { name: new RegExp(label) }),
      ).toBeChecked();
      await expect(page.getByRole("status")).toHaveText(
        "테마 설정을 저장했습니다.",
      );
      if (value !== "system")
        await expect(page.locator("html")).toHaveAttribute("data-theme", value);
      else {
        await page.emulateMedia({ colorScheme: "dark" });
        await expect(page.locator("html")).toHaveAttribute(
          "data-theme",
          "dark",
        );
        await page.emulateMedia({ colorScheme: "light" });
        await expect(page.locator("html")).toHaveAttribute(
          "data-theme",
          "light",
        );
      }
    }
    await page.screenshot({ path: "test-results/settings-dark.png" });
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(page.getByRole("heading", { name: "로그인", exact: true })).toBeVisible();
    await login(page, "alice", fixture.password);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByRole("button", { name: "설정", exact: true }).click();
    await expect(page.getByRole("radio", { name: /다크/ })).toBeChecked();
    await page.getByRole("button", { name: "채팅", exact: true }).click();
    await expect(page.getByRole("log")).toHaveCount(0);
    await page.setViewportSize({ width: 680, height: 560 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(page.getByLabel("메시지 입력")).toBeVisible();
    await page.screenshot({ path: "test-results/chat-compact.png" });
  } finally {
    await app.close();
    await fixture.close();
    await rm(profile, { recursive: true, force: true });
  }
});
