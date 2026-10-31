import { test, expect, _electron as electron } from "@playwright/test";
import { resolve } from "node:path";

test("패키징된 Windows 실행 파일", async () => {
  test.skip(
    !process.env.TEST_PACKAGED_EXE,
    "TEST_PACKAGED_EXE가 지정된 경우 실행",
  );
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] =>
        entry[1] !== undefined && entry[0] !== "ELECTRON_RUN_AS_NODE",
    ),
  );
  const app = await electron.launch({
    executablePath: resolve(process.env.TEST_PACKAGED_EXE!),
    args: [],
    env: environment,
  });
  try {
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
    const page = await app.firstWindow();
    if (process.env.LOCAL_WORKSPACE_MODE === '1' || !process.env.AUTH_SERVER_URL) {
      await expect(page.getByRole('heading', { name: '팀원 작업 공간 선택' })).toBeVisible();
      await expect(page.locator('input[type=password]')).toHaveCount(0);
      return;
    }
    await expect(
      page.getByRole("heading", { name: "로그인", exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("비밀번호", { exact: true })).toHaveAttribute("type", "password");
    await page.screenshot({ path: "test-results/packaged-login.png" });
  } finally {
    await app.close();
  }
});
