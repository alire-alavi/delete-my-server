const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export interface WeeklySchedule {
  day: number; // 0 = Sunday, like Date#getDay
  hour: number;
  minute: number;
}

export function parseSchedule(day: string, time: string): WeeklySchedule {
  const d = day.trim().toLowerCase();
  const index = /^[0-6]$/.test(d) ? Number(d) : DAYS.findIndex((name) => d.length >= 3 && name.startsWith(d));
  if (index < 0) throw new Error(`WEEKLY_DAY must be a weekday name or 0-6 (0 = Sunday), got "${day}"`);

  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const hour = Number(match?.[1]);
  const minute = Number(match?.[2]);
  if (!match || hour > 23 || minute > 59) throw new Error(`WEEKLY_TIME must be HH:MM (24h), got "${time}"`);

  return { day: index, hour, minute };
}

/** Most recent trigger at or before `now`, in the process timezone (TZ). */
export function latestOccurrence(schedule: WeeklySchedule, now: Date): Date {
  const at = new Date(now);
  at.setHours(schedule.hour, schedule.minute, 0, 0);
  // Moving by calendar days (not 24h steps) keeps the wall-clock time correct across DST changes.
  at.setDate(at.getDate() - ((at.getDay() - schedule.day + 7) % 7));
  if (at > now) {
    at.setDate(at.getDate() - 7);
    at.setHours(schedule.hour, schedule.minute, 0, 0);
  }
  return at;
}

export function nextOccurrence(schedule: WeeklySchedule, now: Date): Date {
  const at = latestOccurrence(schedule, now);
  at.setDate(at.getDate() + 7);
  at.setHours(schedule.hour, schedule.minute, 0, 0);
  return at;
}

export function describeSchedule(schedule: WeeklySchedule): string {
  const hh = String(schedule.hour).padStart(2, "0");
  const mm = String(schedule.minute).padStart(2, "0");
  return `every ${DAYS[schedule.day]} at ${hh}:${mm} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`;
}
