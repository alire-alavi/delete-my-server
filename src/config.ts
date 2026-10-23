import { parseSchedule, type WeeklySchedule } from "./weekly";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} (see .env.example)`);
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes"].includes(value.toLowerCase());
}

function int(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) throw new Error(`Env var ${name} must be an integer, got "${value}"`);
  return n;
}

export const config = {
  get yottaEmail() {
    return required("YOTTA_EMAIL");
  },
  get yottaPassword() {
    return required("YOTTA_PASSWORD");
  },
  get telegramToken() {
    return required("TELEGRAM_BOT_TOKEN");
  },
  get telegramChatId() {
    return required("TELEGRAM_CHAT_ID");
  },
  loginUrl: process.env.YOTTA_LOGIN_URL ?? "https://console.yottasrc.com/login",
  serversUrl: process.env.YOTTA_SERVERS_URL ?? "https://console.yottasrc.com/",
  // Optional overrides once the real YottaSrc delete flow is known.
  deleteSelector: process.env.YOTTA_DELETE_SELECTOR || undefined,
  confirmSelector: process.env.YOTTA_CONFIRM_SELECTOR || undefined,
  graceMinutes: int("GRACE_MINUTES", 30),
  reminderMinutes: int("REMINDER_MINUTES", 5),
  // After a restart, overdue jobs get this much extra time so a cancel can still land.
  restartGraceMinutes: int("RESTART_GRACE_MINUTES", 5),
  // Safety default: walk the whole flow but never click the final confirm.
  dryRun: bool("DRY_RUN", true),
  // Cloudflare Turnstile usually rejects headless Chrome; run headed (use xvfb-run on servers).
  headless: bool("HEADLESS", false),
  // "chrome" (Google Chrome, amd64) or "chromium" (Playwright's build, e.g. on arm64).
  browserChannel: process.env.BROWSER_CHANNEL || "chrome",
  // Weekly trigger: at WEEKLY_DAY WEEKLY_TIME (in TZ) the Cancel message goes out for each server.
  weeklyServers: (process.env.WEEKLY_SERVERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  /** null when no WEEKLY_SERVERS are configured; throws on an invalid day/time. */
  get weeklySchedule(): WeeklySchedule | null {
    if (!this.weeklyServers.length) return null;
    return parseSchedule(process.env.WEEKLY_DAY ?? "", process.env.WEEKLY_TIME ?? "");
  },
  // If the service was down at the trigger time, still start the run if we're at most this late.
  weeklyMissedWindowMinutes: int("WEEKLY_MISSED_WINDOW_MINUTES", 60),
  dbPath: process.env.DB_PATH ?? "./data/jobs.sqlite",
  profileDir: process.env.PROFILE_DIR ?? "./data/chrome-profile",
  debugDir: process.env.DEBUG_DIR ?? "./data/debug",
};
