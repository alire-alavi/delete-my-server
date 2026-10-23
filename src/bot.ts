import { Bot, InlineKeyboard, InputFile, type Context } from "grammy";
import { config } from "./config";
import * as jobs from "./db";
import type { Job } from "./db";
import { describeSchedule, nextOccurrence } from "./weekly";

export const bot = new Bot(config.telegramToken);
const chat = config.telegramChatId;

const HELP = [
  "/delete <server> [minutes] - schedule deletion, cancellable until it runs",
  "/jobs - recent jobs",
  "/cancel <id> - cancel a pending job",
  "/next - weekly schedule and next run",
  "",
  "<server> is the server's YottaSrc console URL (most reliable) or its exact name as shown in the server list.",
].join("\n");

function when(job: Job): string {
  const minutes = Math.max(0, Math.round((job.run_at - Date.now()) / 60_000));
  return `${new Date(job.run_at).toLocaleString()} (in ${minutes} min)`;
}

function describe(job: Job): string {
  const tail = job.status === "pending" ? `runs ${when(job)}` : (job.result ?? "");
  return `#${job.id} ${job.server} - ${job.status} ${tail}`.trim();
}

function cancelKeyboard(id: number): InlineKeyboard {
  return new InlineKeyboard().text("🛑 Cancel deletion", `cancel:${id}`);
}

async function clearButton(job: Job): Promise<void> {
  if (job.message_id === null) return;
  await bot.api.editMessageReplyMarkup(chat, job.message_id).catch(() => {});
}

/** Sends the countdown message with the Cancel button and returns its message id. */
export async function announce(job: Job): Promise<number> {
  const dry = config.dryRun ? "\n\n(DRY_RUN is on - the final confirm will NOT be clicked.)" : "";
  const msg = await bot.api.sendMessage(
    chat,
    `⚠️ Job #${job.id}: server "${job.server}" will be DELETED at ${when(job)}.\n\nTap Cancel to stop it.${dry}`,
    { reply_markup: cancelKeyboard(job.id) },
  );
  jobs.setMessageId(job.id, msg.message_id);
  return msg.message_id;
}

export async function remind(job: Job): Promise<void> {
  await bot.api.sendMessage(chat, `⏰ Reminder: job #${job.id} deletes "${job.server}" at ${when(job)}.`, {
    reply_markup: cancelKeyboard(job.id),
    reply_parameters: job.message_id ? { message_id: job.message_id, allow_sending_without_reply: true } : undefined,
  });
}

export async function report(job: Job, text: string): Promise<void> {
  await clearButton(job);
  await bot.api.sendMessage(chat, text, {
    reply_parameters: job.message_id ? { message_id: job.message_id, allow_sending_without_reply: true } : undefined,
  });
}

export async function sendStep(job: Job, label: string, png: Buffer): Promise<void> {
  await bot.api.sendPhoto(chat, new InputFile(png, "step.png"), { caption: `#${job.id}: ${label}` }).catch((err) => {
    console.error("could not send screenshot", err);
  });
}

let codeWaiter: ((code: string) => void) | null = null;

export function askCode(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      codeWaiter = null;
      reject(new Error("No verification code received within 10 minutes"));
    }, 10 * 60_000);
    codeWaiter = (code) => {
      clearTimeout(timer);
      codeWaiter = null;
      resolve(code);
    };
    bot.api.sendMessage(chat, `🔐 ${prompt}`, { reply_markup: { force_reply: true } }).catch(reject);
  });
}

function parseMinutes(raw: string | undefined): number | null {
  if (raw === undefined) return config.graceMinutes;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// Only the configured chat may control the bot; others just learn their chat id (useful during setup).
bot.use(async (ctx: Context, next) => {
  if (String(ctx.chat?.id) === chat) return next();
  if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Not authorized" });
  else if (ctx.message) await ctx.reply(`Not authorized. This chat id is ${ctx.chat?.id}.`);
});

bot.command(["start", "help"], (ctx) => ctx.reply(HELP));

bot.command("delete", async (ctx) => {
  const [server, rawMinutes, ...rest] = ctx.match.trim().split(/\s+/).filter(Boolean);
  const minutes = parseMinutes(rawMinutes);
  if (!server || minutes === null || rest.length) return ctx.reply(`Usage: ${HELP.split("\n")[0]}`);
  await announce(jobs.createJob(server, minutes));
});

export function scheduleSummary(): string {
  const schedule = config.weeklySchedule;
  if (!schedule) return "No weekly schedule (WEEKLY_SERVERS is empty).";
  const next = nextOccurrence(schedule, new Date());
  return [
    `Weekly: Cancel message ${describeSchedule(schedule)}, deletion ${config.graceMinutes} min later.`,
    `Next: ${next.toLocaleString()}`,
    `Servers: ${config.weeklyServers.join(", ")}`,
    config.dryRun ? "DRY_RUN is on: nothing will actually be deleted." : "DRY_RUN is off: deletions are real.",
  ].join("\n");
}

bot.command("next", (ctx) => ctx.reply(scheduleSummary()));

bot.command("jobs", async (ctx) => {
  const list = jobs.listJobs();
  await ctx.reply(list.length ? list.map(describe).join("\n") : "No jobs yet.");
});

async function cancel(id: number): Promise<string> {
  const job = jobs.getJob(id);
  if (!job) return `Job #${id} not found.`;
  if (!jobs.cancelJob(id)) return `Too late: job #${id} is ${job.status}.`;
  await clearButton(job);
  return `✅ Cancelled job #${id}: "${job.server}" will NOT be deleted.`;
}

bot.command("cancel", async (ctx) => {
  const id = Number(ctx.match.trim());
  if (!Number.isInteger(id)) return ctx.reply("Usage: /cancel <id>");
  await ctx.reply(await cancel(id));
});

bot.callbackQuery(/^cancel:(\d+)$/, async (ctx) => {
  const text = await cancel(Number(ctx.match[1]));
  await ctx.answerCallbackQuery({ text: text.slice(0, 190) });
  await ctx.reply(text);
});

// Must stay last: plain text is only meaningful as an answer to askCode().
bot.on("message:text", async (ctx) => {
  if (!codeWaiter) return ctx.reply(HELP);
  codeWaiter(ctx.message.text);
  await ctx.reply("Code received, continuing.");
});

bot.catch((err) => console.error("telegram handler error", err.error));
