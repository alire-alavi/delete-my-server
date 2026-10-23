process.env.TZ = "Europe/Berlin";

import { expect, test } from "bun:test";
import { latestOccurrence, nextOccurrence, parseSchedule } from "./weekly";

// Wall-clock local times in Europe/Berlin.
const local = (s: string) => new Date(s);

test("parses day names, abbreviations and numbers", () => {
  expect(parseSchedule("Friday", "18:00")).toEqual({ day: 5, hour: 18, minute: 0 });
  expect(parseSchedule("fri", "7:05")).toEqual({ day: 5, hour: 7, minute: 5 });
  expect(parseSchedule("0", "23:59")).toEqual({ day: 0, hour: 23, minute: 59 });
  expect(() => parseSchedule("fr", "18:00")).toThrow();
  expect(() => parseSchedule("friday", "24:00")).toThrow();
});

test("latest occurrence: same day after, same day before, and other weekdays", () => {
  const fri18 = parseSchedule("friday", "18:00");
  // 2026-10-23 is a Friday
  expect(latestOccurrence(fri18, local("2026-10-23T18:00:00"))).toEqual(local("2026-10-23T18:00:00"));
  expect(latestOccurrence(fri18, local("2026-10-23T18:30:00"))).toEqual(local("2026-10-23T18:00:00"));
  expect(latestOccurrence(fri18, local("2026-10-23T17:59:00"))).toEqual(local("2026-10-16T18:00:00"));
  expect(latestOccurrence(fri18, local("2026-10-27T09:00:00"))).toEqual(local("2026-10-23T18:00:00"));
  expect(nextOccurrence(fri18, local("2026-10-23T18:30:00"))).toEqual(local("2026-10-30T18:00:00"));
});

test("keeps wall-clock time across the DST change (Berlin falls back on 2026-10-25)", () => {
  const mon09 = parseSchedule("monday", "09:00");
  expect(latestOccurrence(mon09, local("2026-10-26T10:00:00"))).toEqual(local("2026-10-26T09:00:00"));
  expect(latestOccurrence(mon09, local("2026-10-26T08:00:00"))).toEqual(local("2026-10-19T09:00:00"));
  expect(nextOccurrence(mon09, local("2026-10-20T00:00:00"))).toEqual(local("2026-10-26T09:00:00"));
});
