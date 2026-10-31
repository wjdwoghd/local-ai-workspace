import { test, expect, chromium, type Browser } from "@playwright/test";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";

test("단일 포터블 EXE 실행", async () => {
  test.skip(
    !process.env.TEST_PORTABLE_EXE,
    "TEST_PORTABLE_EXE가 지정된 경우 실행",
  );
  test.setTimeout(60000);
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("테스트 포트 생성 실패");
  const port = address.port;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE",
    ),
  );
  const processHandle = spawn(
    resolve(process.env.TEST_PORTABLE_EXE!),
    [`--remote-debugging-port=${port}`],
    { env: environment, windowsHide: true, stdio: "ignore" },
  );
  let browser: Browser | undefined;
  try {
    await expect
      .poll(
        async () => {
          try {
            browser = await chromium.connectOverCDP(
              `http://127.0.0.1:${port}`,
              { timeout: 1000 },
            );
            return true;
          } catch {
            return false;
          }
        },
        { timeout: 45000, intervals: [500, 1000] },
      )
      .toBe(true);
    const context = browser!.contexts()[0];
    const page = context.pages()[0] || (await context.waitForEvent("page"));
    if (process.env.LOCAL_WORKSPACE_MODE === '1' || !process.env.AUTH_SERVER_URL) {
      await expect(page.getByRole('heading', { name: '팀원 작업 공간 선택' })).toBeVisible();
      await expect(page.locator('input[type=password]')).toHaveCount(0);
      return;
    }
    await expect(
      page.getByRole("heading", { name: "로그인", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("비밀번호", { exact: true })).toHaveAttribute("type", "password");
    await page.screenshot({ path: "test-results/portable-login.png" });
  } finally {
    if (browser) {
      await Promise.all(
        browser
          .contexts()
          .flatMap((context) =>
            context.pages().map((page) => page.close().catch(() => {})),
          ),
      );
      await browser.close().catch(() => {});
    }
    processHandle.kill();
  }
});
