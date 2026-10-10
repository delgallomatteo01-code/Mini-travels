import assert from "node:assert/strict";
import test from "node:test";
import { costTotals, generateTripDays, isValidTime, overlappingIds, sanitizeImportedActivities, touchesLockedDay, tripTiming } from "../src/lib/activities";
import { INITIAL_ACTIVITIES, PARIS_TRIP } from "../src/lib/data";
import type { Activity, Trip } from "../src/lib/types";

const activity = (extra: Partial<Activity>): Activity => ({ id: "x", dayId: "sep11", time: "10:00", title: "T", category: "Museo", duration: 60, area: "", cost: 0, status: "Da prenotare", ...extra });

test("Italian day labels match the real calendar (Paris example)", () => {
  const days = generateTripDays(PARIS_TRIP);
  assert.equal(days.length, 8);
  assert.equal(days[0].id, "sep11");
  assert.equal(days[0].full, "Venerdì 11 settembre");
  assert.equal(days[0].date, "2026-09-11");
  assert.equal(days.find((day) => day.id === "sep14")?.full, "Lunedì 14 settembre");
  assert.equal(days.at(-1)?.id, "sep18");
});

test("generic trips get one civil day per date, including month and DST boundaries", () => {
  const trip: Trip = { ...PARIS_TRIP, id: "lisbona-2027-abc123", startDate: "2027-03-27", endDate: "2027-04-01" };
  const days = generateTripDays(trip);
  assert.deepEqual(days.map((day) => day.id), ["day-2027-03-27", "day-2027-03-28", "day-2027-03-29", "day-2027-03-30", "day-2027-03-31", "day-2027-04-01"]);
  assert.equal(days[0].tab, "Sab 27");
  assert.equal(days[1].full, "Domenica 28 marzo");
});

test("Paris keeps its historical day ids only for dates inside the edited range", () => {
  const days = generateTripDays({ ...PARIS_TRIP, endDate: "2026-09-20" });
  assert.equal(days.length, 10);
  assert.equal(days[7].id, "sep18");
  assert.equal(days[8].id, "day-2026-09-19");
});

test("trip timing distinguishes future, current and past", () => {
  assert.equal(tripTiming(PARIS_TRIP, "2026-09-10"), "upcoming");
  assert.equal(tripTiming(PARIS_TRIP, "2026-09-11"), "current");
  assert.equal(tripTiming(PARIS_TRIP, "2026-09-18"), "current");
  assert.equal(tripTiming(PARIS_TRIP, "2026-09-19"), "past");
});

test("costs come from scheduled activities; explicit zero totalCost is honoured", () => {
  const days = generateTripDays(PARIS_TRIP);
  const list = [
    activity({ id: "1", cost: 10 }),
    activity({ id: "2", cost: 15, totalCost: 0 }),
    activity({ id: "3", cost: 20, totalCost: 25 }),
    activity({ id: "4", cost: 100, dayId: "planning" }),
    activity({ id: "5", cost: 100, dayId: "day-1999-01-01" }),
  ];
  assert.deepEqual(costTotals(list, days), { perPerson: 45, couple: 20 + 0 + 25 });
});

test("example itinerary totals are derived, not hard coded", () => {
  const { perPerson, couple } = costTotals(INITIAL_ACTIVITIES, generateTripDays(PARIS_TRIP));
  const expected = INITIAL_ACTIVITIES.filter((item) => item.dayId !== "planning").reduce((sum, item) => sum + item.cost, 0);
  assert.equal(perPerson, expected);
  assert.equal(couple, expected * 2);
});

test("locked day guard catches edits, removals, additions and reordering", () => {
  const before = [activity({ id: "a" }), activity({ id: "b" }), activity({ id: "c", dayId: "sep12" })];
  const locked = new Set(["sep11"]);
  assert.equal(touchesLockedDay(before, before.map((item) => item.id === "c" ? { ...item, title: "Nuovo" } : item), locked), false);
  assert.equal(touchesLockedDay(before, before.map((item) => item.id === "a" ? { ...item, title: "Nuovo" } : item), locked), true);
  assert.equal(touchesLockedDay(before, before.filter((item) => item.id !== "b"), locked), true);
  assert.equal(touchesLockedDay(before, [before[1], before[0], before[2]], locked), true);
  assert.equal(touchesLockedDay(before, before.map((item) => item.id === "c" ? { ...item, dayId: "sep11" } : item), locked), true);
  assert.equal(touchesLockedDay(before, [...before, activity({ id: "d", dayId: "sep11" })], locked), true);
});

test("time validation and overlap detection", () => {
  assert.equal(isValidTime("09:30"), true);
  assert.equal(isValidTime("24:00"), false);
  assert.equal(isValidTime("9:30"), false);
  const overlaps = overlappingIds([activity({ id: "a", time: "10:00", duration: 90 }), activity({ id: "b", time: "11:00" }), activity({ id: "c", time: "13:00" })]);
  assert.deepEqual([...overlaps].sort(), ["a", "b"]);
});

test("imported JSON keeps user values, fills required gaps and rejects duplicates", () => {
  const imported = sanitizeImportedActivities({ trip: {}, activities: [
    { id: "a01", dayId: "sep14", time: "16:30", title: "Montmartre", category: "Passeggiata", note: "La nostra nota", totalCost: 0, ticket: { key: "tickets/x/y/z.pdf", name: "z.pdf", type: "application/pdf" } },
    { id: "z9", dayId: "planning", time: "bad", title: "Idea", category: "Sconosciuta" },
  ] });
  assert.equal(imported[0].dayId, "sep14");
  assert.equal(imported[0].note, "La nostra nota");
  assert.equal(imported[0].totalCost, 0);
  assert.equal(imported[0].ticket?.key, "tickets/x/y/z.pdf");
  assert.equal(imported[1].time, "10:00");
  assert.equal(imported[1].category, "Attrazione");
  assert.equal(imported[1].cost, 0);
  assert.throws(() => sanitizeImportedActivities([{ id: "a", dayId: "x", title: "A" }, { id: "a", dayId: "x", title: "B" }]), /duplicato/);
  assert.throws(() => sanitizeImportedActivities({ nope: true }), /trip, activities/);
});
