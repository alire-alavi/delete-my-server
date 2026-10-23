import { config } from "./config";
import * as jobs from "./db";
import type { Job } from "./db";
import { announce, askCode, bot, remind, report, scheduleSummary, sendStep } from "./bot";
import { latestOccurrence } from "./weekly";
import { deleteServer, openBrowser } from "./yotta";

const TICK_MS = 5_000;
const weekly = config.weeklySchedule; // validates WEEKLY_DAY/WEEKLY_TIME at startup
let busy = false;

/** At the weekly trigger, queue one cancellable job per configured server (once per occurrence). */
function startWeeklyRun(): void {
  if (!weekly) return;
  const now = new Date();
  const occurrence = latestOccurrence(weekly, now);
  if (now.getTime() - occurrence.getTime() > config.weeklyMissedWindowMinutes * 60_000) return;
  if (!jobs.claimWeeklyRun(occurrence.getTime())) return;
  for (const server of config.weeklyServers) jobs.createJob(server, config.graceMinutes);
}

async function run(job: Job): Promise<void> {
  await report(job, `▶️ Grace period over for job #${job.id}, deleting "${job.server}" now${config.dryRun ? " (DRY RUN)" : ""}.`);
  const context = await openBrowser();
  try {
    const result = await deleteServer(context, job.server, { dryRun: config.dryRun }, {
      askCode,
      step: (label, png) => sendStep(job, label, png),
    });
    jobs.finishJob(job.id, "done", result);
    await report(job, `✅ ${result}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobs.finishJob(job.id, "failed", message);
    await report(job, `❌ Job #${job.id} failed: ${message}`);
  } finally {
    await context.close().catch(() => {});
  }
}

async function tick(): Promise<void> {
  if (busy) return; // one browser at a time: the persistent profile can't be opened twice
  busy = true;
  try {
    startWeeklyRun();
    for (const job of jobs.pendingJobs()) {
      const now = Date.now();
      // Never delete without having shown a Cancel button for at least restartGraceMinutes.
      if (job.message_id === null) {
        if (job.run_at < now + config.restartGraceMinutes * 60_000) {
          jobs.postpone(job.id, now + config.restartGraceMinutes * 60_000);
        }
        await announce(jobs.getJob(job.id)!);
        continue;
      }
      if (!job.reminded && config.reminderMinutes > 0 && job.run_at - now <= config.reminderMinutes * 60_000 && job.run_at > now) {
        await remind(job);
        jobs.markReminded(job.id);
      }
      if (jobs.claimJob(job.id)) await run(job);
    }
  } catch (err) {
    console.error("scheduler tick failed", err);
  } finally {
    busy = false;
  }
}

async function recover(): Promise<void> {
  for (const job of jobs.failInterruptedJobs()) {
    await report(job, `⚠️ Job #${job.id} (${job.server}) was interrupted by a restart mid-run. Check the server manually.`);
  }
  // Cancel clicks made while we were down are delivered after startup, so give them time to land.
  const deadline = Date.now() + config.restartGraceMinutes * 60_000;
  for (const job of jobs.pendingJobs()) {
    if (job.message_id !== null && job.run_at < deadline) {
      jobs.postpone(job.id, deadline);
      await remind(jobs.getJob(job.id)!); // report() would strip the Cancel button
    }
  }
}

await recover();
await bot.api
  .sendMessage(config.telegramChatId, `🟢 Deletion guard started.\n\n${scheduleSummary()}`)
  .catch((err) => console.error("could not send startup message", err));
console.log(scheduleSummary());
const timer = setInterval(tick, TICK_MS);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    clearInterval(timer);
    await bot.stop();
    process.exit(0);
  });
}

console.log(`deletion guard running (dryRun=${config.dryRun}, grace=${config.graceMinutes}m)`);
await bot.start({ onStart: (me) => console.log(`telegram bot @${me.username} polling`) });
