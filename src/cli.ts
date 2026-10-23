import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";
import * as jobs from "./db";
import { deleteServer, openBrowser } from "./yotta";

const [command, ...args] = process.argv.slice(2);

async function login(): Promise<void> {
  // Headed on purpose: solve Turnstile / the email code by hand once, the profile remembers the session.
  const context = await openBrowser(false);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(config.loginUrl);
  if (process.env.YOTTA_EMAIL) await page.locator("#ClientEmail").fill(config.yottaEmail).catch(() => {});
  if (process.env.YOTTA_PASSWORD) await page.locator("#ClientPassword").fill(config.yottaPassword).catch(() => {});
  await page.locator("#remember").check().catch(() => {});
  console.log("Finish logging in in the browser window (captcha, verification code). Waiting up to 10 minutes...");
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 10 * 60_000 });
  console.log(`Logged in, session saved to ${config.profileDir}`);
  await context.close();
}

async function dryRun(server: string): Promise<void> {
  mkdirSync(config.debugDir, { recursive: true });
  let n = 0;
  const context = await openBrowser();
  try {
    const result = await deleteServer(context, server, { dryRun: true }, {
      askCode: async (question) => prompt(`${question}\n>`) ?? "",
      step: async (label, png) => {
        const file = join(config.debugDir, `dry-run-${++n}.png`);
        await Bun.write(file, png);
        console.log(`[${label}] ${file}`);
      },
    });
    console.log(result);
  } finally {
    await context.close();
  }
}

switch (command) {
  case "login":
    await login();
    break;
  case "dry-run":
    if (!args[0]) throw new Error("usage: bun run dry-run <server>");
    await dryRun(args[0]);
    break;
  case "schedule": {
    const [server, minutes] = args;
    if (!server) throw new Error("usage: bun run schedule <server> [minutes]");
    const job = jobs.createJob(server, minutes ? Number(minutes) : config.graceMinutes);
    console.log(`Scheduled job #${job.id}; the running service will send the Telegram cancel button.`);
    break;
  }
  case "jobs":
    console.table(jobs.listJobs());
    break;
  default:
    console.log("commands: login | dry-run <server> | schedule <server> [minutes] | jobs");
}
