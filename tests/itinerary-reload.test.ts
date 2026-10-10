// Port of the original tests/itinerary-reload.test.mjs: the loader used for
// server responses and the local cache must never move or rewrite activities.
import assert from "node:assert/strict";
import test from "node:test";
import { normalizeActivities } from "../src/lib/activities";

const reload = (activities: unknown) => JSON.parse(JSON.stringify(normalizeActivities(JSON.parse(JSON.stringify(activities)))));

test("activities moved from September 11 to 14 survive repeated reloads", () => {
  const saved = Array.from({ length: 9 }, (_, index) => ({
    id: `a0${index + 1}`, dayId: "sep14", time: "10:30", title: `Attività ${index + 1}`,
  }));
  assert.deepEqual(reload(reload(saved)), saved);
});

test("planning and other chosen days are preserved, including the anniversary", () => {
  for (const dayId of ["planning", "sep11", "sep12", "sep13", "sep14", "sep18", "day-2027-03-02"]) {
    const saved = [{ id: "a10", dayId, time: "20:30", title: "Cena modificata", category: "Ristorante", note: "Nota personale" }];
    assert.deepEqual(reload(saved), saved);
  }
});

test("reload preserves edited content, order and attachments", () => {
  const saved = [
    { id: "e07", dayId: "sep14", time: "21:00", title: "Nuovo ristorante", note: "Prenotazione confermata", category: "Ristorante", ticket: { key: "ticket.pdf", name: "Biglietto", type: "application/pdf" } },
    { id: "a07", dayId: "sep14", time: "16:00", title: "Montmartre", cost: 12 },
  ];
  assert.deepEqual(reload(saved), saved);
});

test("image normalization and invalid-payload checks still work", () => {
  const item = { id: "custom", dayId: "sep14", time: "10:00", title: "Visita", image: "  //example.com/photo.jpg  " };
  assert.equal(reload([item])[0].image, "https://example.com/photo.jpg");
  assert.equal(normalizeActivities(null), null);
  assert.equal(normalizeActivities([{}]), null);
  assert.deepEqual(reload([]), []);
});
