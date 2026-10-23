import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import { mkdirSync } from "node:fs";
import { config } from "./config";

export interface RunHooks {
  /** Called when YottaSrc shows its verification-code dialog; must resolve with the code. */
  askCode(prompt: string): Promise<string>;
  /** Progress report with a screenshot of the current page. */
  step(label: string, screenshot: Buffer): Promise<void>;
}

// Exact-ish names only, so "Delete snapshot" or "Delete backup" never match.
const DELETE_NAME = /^\s*(delete|terminate|destroy|remove)(\s+(server|vps|vds|instance|service))?\s*$/i;
const CONFIRM_NAME = /^\s*(yes|confirm|delete|terminate|destroy|ok|yes,?\s*delete.*)\s*$/i;

export async function openBrowser(headless = config.headless): Promise<BrowserContext> {
  mkdirSync(config.profileDir, { recursive: true });
  // Persistent profile keeps the "remember me" session, so Turnstile is rarely hit again.
  return chromium.launchPersistentContext(config.profileDir, {
    channel: config.browserChannel,
    headless,
    viewport: { width: 1366, height: 900 },
  });
}

function isLoginUrl(url: string): boolean {
  return new URL(url).pathname.startsWith(new URL(config.loginUrl).pathname);
}

async function snap(page: Page, hooks: RunHooks, label: string): Promise<void> {
  await hooks.step(label, await page.screenshot({ fullPage: false }));
}

export async function ensureLoggedIn(page: Page, hooks: RunHooks): Promise<void> {
  await page.goto(config.loginUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  if (!isLoginUrl(page.url())) return; // session cookie still valid, console redirected us

  await page.locator("#ClientEmail").fill(config.yottaEmail);
  await page.locator("#ClientPassword").fill(config.yottaPassword);
  await page.locator("#remember").check().catch(() => {});

  // Cloudflare Turnstile fills this hidden input once it trusts the browser.
  const turnstile = page.locator('input[name="cf-turnstile-response"]');
  if (await turnstile.count()) {
    await page
      .waitForFunction(
        () => (document.querySelector('input[name="cf-turnstile-response"]') as HTMLInputElement | null)?.value,
        null,
        { timeout: 90_000 },
      )
      .catch(async () => {
        await snap(page, hooks, "Turnstile not solved");
        throw new Error("Cloudflare Turnstile was not solved. Run `bun run login` once in a headed browser.");
      });
  }

  await page.getByRole("button", { name: "Login", exact: true }).click();

  const code = page.locator("#verification_code");
  const outcome = await Promise.race([
    page.waitForURL((u) => !isLoginUrl(u.toString()), { timeout: 60_000 }).then(() => "in" as const),
    code.waitFor({ state: "visible", timeout: 60_000 }).then(() => "code" as const),
  ]).catch(() => "timeout" as const);

  if (outcome === "code") {
    await snap(page, hooks, "YottaSrc asks for a verification code");
    const value = await hooks.askCode("YottaSrc sent a verification code (check your email). Reply with the code.");
    await code.fill(value.trim());
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await page.waitForURL((u) => !isLoginUrl(u.toString()), { timeout: 60_000 });
  } else if (outcome === "timeout") {
    await snap(page, hooks, "Login did not complete");
    throw new Error("Login did not complete (wrong credentials, captcha or changed page).");
  }
}

async function openServerPage(page: Page, server: string): Promise<void> {
  // A direct console URL is the most reliable way to name a server.
  if (/^https?:\/\//.test(server)) {
    await page.goto(server, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    return;
  }

  await page.goto(config.serversUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  const matches = page.getByText(server, { exact: true });
  const count = await matches.count();
  if (count === 0) throw new Error(`Server "${server}" not found on ${config.serversUrl}`);
  if (count > 1) throw new Error(`"${server}" matches ${count} elements; pass the server's console URL instead`);

  const match = matches.first();
  const row = match.locator("xpath=ancestor::tr[1]");
  const target: Locator = (await row.count()) && (await row.getByRole("link").count()) ? row.getByRole("link").first() : match;
  await target.click();
  await page.waitForLoadState("networkidle").catch(() => {});
}

async function single(locator: Locator, what: string): Promise<Locator> {
  const visible = locator.filter({ visible: true });
  const count = await visible.count();
  if (count !== 1) throw new Error(`Expected exactly one ${what}, found ${count}. Set the selector in .env.`);
  return visible.first();
}

/**
 * Logs in and deletes `server` (a console URL or the exact name/hostname shown in the server list).
 * With dryRun it stops at the final confirmation dialog and closes it instead.
 */
export async function deleteServer(
  context: BrowserContext,
  server: string,
  opts: { dryRun: boolean },
  hooks: RunHooks,
): Promise<string> {
  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(30_000);

  await ensureLoggedIn(page, hooks);
  await openServerPage(page, server);
  await snap(page, hooks, `Server page for ${server}`);

  const deleteButton = await single(
    config.deleteSelector
      ? page.locator(config.deleteSelector)
      : page.getByRole("button", { name: DELETE_NAME }).or(page.getByRole("link", { name: DELETE_NAME })),
    "delete button",
  );
  await deleteButton.click();

  // The console uses SweetAlert2 and Bootstrap modals for confirmations.
  const dialog = page.locator(".swal2-popup:visible, .modal.show").first();
  await dialog.waitFor({ state: "visible" });
  const confirmInput = dialog.locator('input[type="text"]:visible').first();
  if (await confirmInput.count()) await confirmInput.fill(server);
  await snap(page, hooks, opts.dryRun ? "DRY RUN: final confirmation (not clicked)" : "Final confirmation");

  const confirm = await single(
    config.confirmSelector
      ? page.locator(config.confirmSelector)
      : dialog.locator(".swal2-confirm").or(dialog.getByRole("button", { name: CONFIRM_NAME })),
    "confirm button",
  );

  if (opts.dryRun) {
    await page.keyboard.press("Escape");
    return `Dry run OK: found the delete button and confirm button ("${(await confirm.innerText()).trim()}") for ${server}. Nothing was deleted.`;
  }

  await confirm.click();
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(3_000);
  await snap(page, hooks, "After confirming deletion");
  return `Deletion of ${server} confirmed in the YottaSrc console.`;
}
