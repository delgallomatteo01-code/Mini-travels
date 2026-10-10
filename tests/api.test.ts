import assert from "node:assert/strict";
import test from "node:test";
import { createClient, createTestEnv, SAMPLE_TRIP } from "./helpers";

type TripResponse = { trip: { id: string } };
type ItineraryResponse = { activities: Array<Record<string, unknown>> | null; version: number; conflict?: boolean };

async function setup() {
  const env = createTestEnv();
  const client = createClient(env);
  assert.equal((await client.login()).status, 200);
  const { data } = await client.json<TripResponse>("/api/trips", { method: "POST", body: JSON.stringify(SAMPLE_TRIP) });
  return { env, client, tripId: data.trip.id };
}

const put = (client: ReturnType<typeof createClient>, tripId: string, activities: unknown, version: number) =>
  client.json<ItineraryResponse>("/api/itinerary", { method: "PUT", body: JSON.stringify({ tripId, activities, version }) });

test("access requires the shared password; public endpoints stay public", async () => {
  const env = createTestEnv();
  const client = createClient(env);
  assert.equal((await client.call("/api/trips")).status, 401);
  assert.equal((await client.call("/api/tickets?key=tickets/a/b/c.pdf")).status, 401);
  assert.equal((await client.call("/api/site-assets?kind=traveller-one")).status, 401);
  assert.equal((await client.call("/api/manifest")).status, 200);
  assert.equal((await client.call("/api/site-assets?kind=logo")).status, 307);
  assert.equal((await client.login("sbagliata")).status, 401);
  assert.equal((await client.call("/api/trips")).status, 401);
  assert.equal((await client.login()).status, 200);
  assert.equal((await client.call("/api/trips")).status, 200);
  assert.equal((await client.call("/api/logout", { method: "POST" })).status, 200);
  assert.equal((await client.call("/api/trips")).status, 401);
});

test("without APP_PASSWORD nobody gets in (unless AUTH_DISABLED is explicit)", async () => {
  const closed = createClient(createTestEnv({ APP_PASSWORD: undefined }));
  assert.equal((await closed.login("")).status, 503);
  assert.equal((await closed.call("/api/trips")).status, 401);
  const open = createClient(createTestEnv({ APP_PASSWORD: undefined, AUTH_DISABLED: "true" }));
  assert.equal((await open.call("/api/trips")).status, 200);
});

test("a forged or expired session cookie is rejected", async () => {
  const env = createTestEnv();
  const forged = await (await import("../server/app")).handleApiRequest(new Request("https://x/api/trips", { headers: { Cookie: "mev_session=99999999999999.abc" } }), env);
  assert.equal(forged.status, 401);
  const { createSessionToken, verifySessionToken } = await import("../server/auth");
  const token = await createSessionToken(env, Date.now() - 400 * 86_400_000);
  assert.equal(await verifySessionToken(env, token), false);
  assert.equal(await verifySessionToken({ ...env, APP_PASSWORD: "altra-password" }, await createSessionToken(env)), false);
});

test("cross-site writes are refused", async () => {
  const { client } = await setup();
  const response = await client.call("/api/trips", { method: "POST", body: JSON.stringify(SAMPLE_TRIP), headers: { Origin: "https://evil.example" } });
  assert.equal(response.status, 403);
});

test("trip validation: dates, order and image URL", async () => {
  const { client } = await setup();
  for (const bad of [
    { ...SAMPLE_TRIP, endDate: "2026-09-10" },
    { ...SAMPLE_TRIP, startDate: "2026-02-31" },
    { ...SAMPLE_TRIP, image: "javascript:alert(1)" },
    { ...SAMPLE_TRIP, title: "  " },
  ]) {
    assert.equal((await client.call("/api/trips", { method: "POST", body: JSON.stringify(bad) })).status, 400);
  }
});

test("an activity moved from the 11th to the 14th stays there after reload and from another device", async () => {
  const { env, client, tripId } = await setup();
  const first = await put(client, tripId, [{ id: "a01", dayId: "sep11", time: "06:00", title: "Arrivo" }, { id: "a10", dayId: "sep12", time: "20:00", title: "Anniversario" }], 0);
  assert.equal(first.status, 201);
  assert.equal(first.data.version, 1);
  const moved = await put(client, tripId, [{ id: "a01", dayId: "sep14", time: "06:00", title: "Arrivo" }, { id: "a10", dayId: "sep15", time: "21:00", title: "Cena spostata", note: "nota" }], 1);
  assert.equal(moved.status, 200);

  const otherDevice = createClient(env);
  await otherDevice.login();
  for (const reader of [client, otherDevice]) {
    const { data } = await reader.json<ItineraryResponse>(`/api/itinerary?tripId=${tripId}`);
    assert.equal(data.version, 2);
    assert.deepEqual(data.activities, [{ id: "a01", dayId: "sep14", time: "06:00", title: "Arrivo" }, { id: "a10", dayId: "sep15", time: "21:00", title: "Cena spostata", note: "nota" }]);
  }
});

test("stale versions get 409 with the current server state, never a silent overwrite", async () => {
  const { client, tripId } = await setup();
  await put(client, tripId, [{ id: "x", dayId: "sep11", time: "10:00", title: "A" }], 0);
  await put(client, tripId, [{ id: "x", dayId: "sep11", time: "10:00", title: "B" }], 1);
  const stale = await put(client, tripId, [{ id: "x", dayId: "sep11", time: "10:00", title: "C" }], 1);
  assert.equal(stale.status, 409);
  assert.equal(stale.data.conflict, true);
  assert.equal(stale.data.version, 2);
  assert.equal(stale.data.activities?.[0].title, "B");
  const secondCreate = await put(client, tripId, [], 0);
  assert.equal(secondCreate.status, 409, "version 0 cannot recreate an existing itinerary");
});

test("rapid consecutive saves with the right versions all land in order", async () => {
  const { client, tripId } = await setup();
  let version = 0;
  for (let index = 0; index < 20; index += 1) {
    const result = await put(client, tripId, [{ id: "x", dayId: "sep11", time: "10:00", title: `v${index}` }], version);
    assert.ok(result.status === 200 || result.status === 201);
    version = result.data.version;
  }
  const { data } = await client.json<ItineraryResponse>(`/api/itinerary?tripId=${tripId}`);
  assert.equal(data.version, 20);
  assert.equal(data.activities?.[0].title, "v19");
});

test("itinerary payload validation", async () => {
  const { client, tripId } = await setup();
  assert.equal((await put(client, tripId, [{ id: "x" }], 0)).status, 400);
  assert.equal((await put(client, tripId, [{ id: "x", dayId: "a", time: "1", title: "t" }, { id: "x", dayId: "a", time: "1", title: "t" }], 0)).status, 400, "duplicate ids");
  assert.equal((await put(client, "non-esiste", [], 0)).status, 404);
  assert.equal((await put(client, "../etc", [], 0)).status, 400);
});

test("trips are isolated: deleting one removes only its itinerary and documents", async () => {
  const { env, client, tripId } = await setup();
  const other = (await client.json<TripResponse>("/api/trips", { method: "POST", body: JSON.stringify({ ...SAMPLE_TRIP, title: "LISBONA", destination: "Lisbona" }) })).data.trip.id;
  await put(client, tripId, [{ id: "a", dayId: "sep11", time: "10:00", title: "Parigi" }], 0);
  await put(client, other, [{ id: "a", dayId: "day-2026-09-11", time: "10:00", title: "Lisbona" }], 0);

  const upload = async (trip: string) => {
    const form = new FormData();
    form.set("file", new File(["%PDF-1.4 test"], "biglietto.pdf", { type: "application/pdf" }));
    form.set("tripId", trip);
    form.set("activityId", "a");
    return (await client.json<{ ticket: { key: string } }>("/api/tickets", { method: "POST", body: form })).data.ticket.key;
  };
  const keyA = await upload(tripId);
  const keyB = await upload(other);
  assert.match(keyA, new RegExp(`^tickets/${tripId}/a/`));

  const deleted = await client.json<{ deleted: boolean }>(`/api/trips?id=${tripId}`, { method: "DELETE" });
  assert.equal(deleted.data.deleted, true);
  assert.equal((await client.call(`/api/tickets?key=${encodeURIComponent(keyA)}`)).status, 404);
  assert.equal((await client.call(`/api/tickets?key=${encodeURIComponent(keyB)}`)).status, 200);
  const remaining = await client.json<ItineraryResponse>(`/api/itinerary?tripId=${other}`);
  assert.equal(remaining.data.activities?.[0].title, "Lisbona");
  const gone = await client.json<ItineraryResponse>(`/api/itinerary?tripId=${tripId}`);
  assert.equal(gone.data.activities, null);
  assert.equal((await env.BUCKET.list({ prefix: `tickets/${tripId}/` })).objects.length, 0);
});

test("tickets: allowed formats, content check, 15 MB limit, MIME and name preserved", async () => {
  const { client, tripId } = await setup();
  const send = (file: File) => {
    const form = new FormData();
    form.set("file", file);
    form.set("tripId", tripId);
    form.set("activityId", "a01");
    return client.json<{ ticket?: { key: string; name: string; type: string }; error?: string }>("/api/tickets", { method: "POST", body: form });
  };
  const ok = await send(new File(["BEGIN:VCALENDAR\nEND:VCALENDAR"], "evento.ics", { type: "" }));
  assert.equal(ok.status, 201);
  assert.equal(ok.data.ticket?.type, "text/calendar");
  assert.equal(ok.data.ticket?.name, "evento.ics");
  const opened = await client.call(`/api/tickets?key=${encodeURIComponent(ok.data.ticket!.key)}`);
  assert.equal(opened.headers.get("Content-Type"), "text/calendar");
  assert.match(opened.headers.get("Content-Disposition") ?? "", /evento\.ics/);
  assert.equal((await send(new File([new Uint8Array([0x50, 0x4b, 3, 4])], "pass.pkpass", { type: "application/vnd.apple.pkpass" }))).status, 201);
  assert.equal((await send(new File(["<html>"], "x.html", { type: "text/html" }))).status, 400);
  assert.equal((await send(new File(["not a pdf"], "x.pdf", { type: "application/pdf" }))).status, 400);
  assert.equal((await send(new File([new Uint8Array(15 * 1024 * 1024 + 1)], "big.pdf", { type: "application/pdf" }))).status, 400);
  assert.equal((await client.call("/api/tickets?key=site/logo")).status, 400);
  assert.equal((await client.call("/api/tickets?key=tickets/../site/logo")).status, 400);
});

test("migration import keeps the trip id, every activity field and never touches other trips", async () => {
  const { client, tripId } = await setup();
  await put(client, tripId, [{ id: "keep", dayId: "sep11", time: "10:00", title: "Esistente" }], 0);
  const exported = {
    trip: { ...SAMPLE_TRIP, id: "parigi-2026", title: "PARIGI VERO" },
    activities: [
      { id: "a01", dayId: "sep14", time: "06:00", title: "Arrivo spostato", category: "Trasporto", note: "nota mia", ticket: { key: "tickets/parigi-2026/a01/1-x.pdf", name: "x.pdf", type: "application/pdf" } },
      { id: "p1", dayId: "planning", time: "10:00", title: "Giverny" },
    ],
  };
  const imported = await client.json<{ trip: { id: string }; ticketReferences: number }>("/api/trips/import", { method: "POST", body: JSON.stringify(exported) });
  assert.equal(imported.status, 201);
  assert.equal(imported.data.trip.id, "parigi-2026");
  assert.equal(imported.data.ticketReferences, 1);
  const { data } = await client.json<ItineraryResponse>("/api/itinerary?tripId=parigi-2026");
  assert.deepEqual(data.activities, exported.activities);
  assert.equal(data.version, 1);

  const again = await client.call("/api/trips/import", { method: "POST", body: JSON.stringify(exported) });
  assert.equal(again.status, 409, "an existing id is never overwritten");
  const copy = await client.json<{ trip: { id: string } }>("/api/trips/import", { method: "POST", body: JSON.stringify({ ...exported, keepId: false }) });
  assert.equal(copy.status, 201);
  assert.notEqual(copy.data.trip.id, "parigi-2026");

  const untouched = await client.json<ItineraryResponse>(`/api/itinerary?tripId=${tripId}`);
  assert.equal(untouched.data.activities?.[0].title, "Esistente");
  assert.equal((await client.json<{ trips: unknown[] }>("/api/trips")).data.trips.length, 3);
});

test("settings: texts trimmed, colours validated, palette defaults for a new installation", async () => {
  const { client } = await setup();
  const initial = await client.json<{ settings: Record<string, string> }>("/api/site-settings");
  assert.equal(initial.data.settings.backgroundColor, "#FFFFFF");
  assert.equal(initial.data.settings.textColor, "#000000");
  assert.equal(initial.data.settings.accentColor, "#528019");
  const saved = await client.json<{ settings: Record<string, string> }>("/api/site-settings", { method: "PUT", body: JSON.stringify({ appName: "  I nostri viaggi  ", accentColor: "red", cardColor: "#FAFAFA" }) });
  assert.equal(saved.data.settings.appName, "I nostri viaggi");
  assert.equal(saved.data.settings.accentColor, "#528019");
  assert.equal(saved.data.settings.cardColor, "#FAFAFA");
  const manifest = await (await client.call("/api/manifest")).json() as { short_name: string };
  assert.equal(manifest.short_name, "I nostri viaggi");
});
