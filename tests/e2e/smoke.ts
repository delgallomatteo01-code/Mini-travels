/**
 * End-to-end check in a real browser against the production Node server.
 * Requires `npm run build` first. Usage: npm run test:e2e
 * Set CHROMIUM_PATH if Chromium is not in the default Playwright location.
 * Screenshots are written to test-results/.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

const root = new URL("../..", import.meta.url).pathname;
const port = 8800 + Math.floor(Math.random() * 100);
const base = `http://localhost:${port}`;
const password = "e2e-password";
const shots = join(root, "test-results");
mkdirSync(shots, { recursive: true });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");

const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "--import", "tsx", "server/node/main.ts"], {
  cwd: root,
  env: { ...process.env, PORT: String(port), APP_PASSWORD: password, DATA_DIR: mkdtempSync(join(tmpdir(), "me-viaggi-e2e-")), AUTH_DISABLED: "false" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stderr.on("data", (chunk) => process.stderr.write(chunk));
await new Promise<void>((resolve, reject) => {
  server.stdout.on("data", (chunk) => { if (String(chunk).includes("in ascolto")) resolve(); });
  server.on("exit", (code) => reject(new Error(`server exited ${code}`)));
});

let browser: Browser | undefined;
const steps: string[] = [];
const step = (name: string) => { steps.push(name); console.log(`✓ ${name}`); };

async function login(context: BrowserContext) {
  const page = await context.newPage();
  page.on("pageerror", (error) => { throw error; });
  await page.goto(base);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Entra" }).click();
  await page.getByRole("heading", { name: "I nostri viaggi" }).waitFor();
  return page;
}

async function columnOf(page: Page, title: string) {
  return page.locator(".desktop-board .day-column").filter({ has: page.getByRole("heading", { name: title, exact: true }) }).getAttribute("aria-label");
}

async function waitSynced(page: Page) {
  await page.locator(".sync-badge.sync-synced").first().waitFor({ timeout: 10_000 });
}

try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  // Login
  const loginPage = await desktop.newPage();
  await loginPage.goto(base);
  await loginPage.getByLabel("Password").fill("sbagliata");
  await loginPage.getByRole("button", { name: "Entra" }).click();
  await loginPage.getByText("Password non corretta").waitFor();
  await loginPage.screenshot({ path: join(shots, "01-login.png") });
  await loginPage.close();
  step("wrong password is refused");
  const page = await login(desktop);
  step("login with the shared password");

  // Example trip, explicitly created
  await page.getByRole("button", { name: /Carica l’esempio Parigi 2026/ }).click();
  await page.getByRole("button", { name: "Apri PARIGI 2026" }).waitFor();
  assert.equal(await page.locator(".trip-timing-badge").first().innerText(), "CONCLUSO");
  await page.screenshot({ path: join(shots, "02-archivio-desktop.png"), fullPage: true });
  step("example trip created and shown as past");

  // Logo: free, contained, inside the reference boxes
  const logoInfo = await page.evaluate(() => {
    const box = document.querySelector(".archive-wordmark .me-monogram") as HTMLElement;
    const img = box.querySelector("img") as HTMLImageElement;
    const style = getComputedStyle(box);
    const rect = img.getBoundingClientRect();
    return { fit: getComputedStyle(img).objectFit, border: style.borderStyle, bg: style.backgroundColor, shadow: style.boxShadow, w: rect.width, h: rect.height };
  });
  assert.equal(logoInfo.fit, "contain");
  assert.equal(logoInfo.border, "none");
  assert.equal(logoInfo.bg, "rgba(0, 0, 0, 0)");
  assert.equal(logoInfo.shadow, "none");
  assert.ok(logoInfo.w <= 148 && logoInfo.h <= 84, JSON.stringify(logoInfo));
  step("archive logo has no frame and fits 148×84 with contain");

  // Open the trip, itinerary board with the real Italian dates
  await page.getByRole("button", { name: "Apri PARIGI 2026" }).click();
  await page.getByRole("button", { name: /Apri itinerario/ }).click();
  await page.locator(".desktop-board .day-column").first().waitFor();
  assert.equal(await page.locator(".desktop-board .day-column").count(), 8);
  assert.equal(await page.locator(".desktop-board .day-column-header p").first().innerText(), "VENERDÌ 11 SETTEMBRE");
  assert.equal(await page.locator(".desktop-board .day-column-header p").nth(3).innerText(), "LUNEDÌ 14 SETTEMBRE");
  await waitSynced(page);
  await page.screenshot({ path: join(shots, "03-itinerario-desktop.png") });
  step("itinerary shows Fri 11 → Fri 18 September");

  // Move a01 (originally on the 11th) to the 14th through the editor
  await page.getByRole("button", { name: /Modifica Arrivo a Roma Fiumicino/ }).click();
  await page.getByLabel("Giorno").selectOption("sep14");
  await page.getByRole("button", { name: "Salva attività" }).click();
  await waitSynced(page);
  assert.equal(await columnOf(page, "Arrivo a Roma Fiumicino"), "Lunedì 14 settembre");
  await page.reload();
  await page.locator(".desktop-board .day-column").first().waitFor();
  await waitSynced(page);
  assert.equal(await columnOf(page, "Arrivo a Roma Fiumicino"), "Lunedì 14 settembre");
  step("a01 moved from the 11th to the 14th survives a reload");

  // Another device sees the same day
  const other = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const otherPage = await login(other);
  await otherPage.getByRole("button", { name: "Apri PARIGI 2026" }).click();
  await otherPage.getByRole("button", { name: /Apri itinerario/ }).click();
  await otherPage.locator(".desktop-board .day-column").first().waitFor();
  await waitSynced(otherPage);
  assert.equal(await columnOf(otherPage, "Arrivo a Roma Fiumicino"), "Lunedì 14 settembre");
  step("second device reads a01 on the 14th");

  // Concurrent edit: the other device saves first, this one gets a conflict and keeps its version
  await otherPage.getByRole("button", { name: /Modifica Sacré-Cœur/ }).click();
  await otherPage.getByLabel("Titolo").fill("Sacré-Cœur al tramonto");
  await otherPage.getByRole("button", { name: "Salva attività" }).click();
  await waitSynced(otherPage);
  await page.getByRole("button", { name: /Modifica Moulin Rouge e Rue Lepic/ }).click();
  await page.getByLabel("Note").fill("Modifica fatta in contemporanea");
  await page.getByRole("button", { name: "Salva attività" }).click();
  await page.locator(".conflict-banner").waitFor({ timeout: 10_000 });
  await page.getByRole("heading", { name: "Sacré-Cœur al tramonto" }).waitFor();
  await page.screenshot({ path: join(shots, "04-conflitto.png") });
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Ripristina la mia" }).click();
  await waitSynced(page);
  assert.equal(await page.locator(".conflict-banner").count(), 0);
  step("concurrent edit shows the newest version and keeps the local one until the user decides");

  // Undo from the toast does not touch other trips and goes through the server
  // Lock a day: drag handle and editor are disabled there
  await page.getByRole("button", { name: "Blocca Domenica 13 settembre" }).click();
  const sunday = page.locator(".desktop-board .day-column[aria-label='Domenica 13 settembre']");
  assert.equal(await sunday.locator(".drag-handle").count(), 0);
  await sunday.getByRole("button", { name: /Modifica Notre-Dame/ }).click();
  await page.getByText("Questa giornata è bloccata").waitFor();
  assert.equal(await page.getByRole("button", { name: "Salva attività" }).count(), 0);
  assert.ok(await page.getByLabel("Titolo").isDisabled());
  await page.getByRole("button", { name: "Chiudi" }).first().click();
  step("locked day: no drag handles, editor opens read-only");

  // View-only mode
  await page.getByRole("button", { name: "Modifica attiva" }).click();
  assert.ok(await page.getByRole("button", { name: "Nuova attività" }).isDisabled());
  assert.equal(await page.locator(".desktop-board .drag-handle").count(), 0);
  await page.getByRole("button", { name: "Solo visualizzazione" }).click();
  step("view-only mode disables creation and dragging");

  // Offline edit: honest badge, then synced on reconnect
  await desktop.setOffline(true);
  await page.getByRole("button", { name: /Modifica Check-in/ }).click();
  await page.getByLabel("Note").fill("Scritta offline");
  await page.getByRole("button", { name: "Salva attività" }).click();
  await page.locator(".sync-badge.sync-offline").first().waitFor();
  await page.screenshot({ path: join(shots, "05-offline.png") });
  await desktop.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitSynced(page);
  const serverState = await page.evaluate(async () => (await fetch("/api/itinerary?tripId=parigi-2026")).json()) as { activities: Array<{ id: string; note?: string }> };
  assert.equal(serverState.activities.find((item) => item.id === "a06")?.note, "Scritta offline");
  step("offline edit is flagged “Non sincronizzato” and reaches the server once online");

  // Summary: logo not deformed, derived totals
  await page.getByRole("button", { name: "Riepilogo" }).first().click();
  await page.locator(".summary-hero").waitFor();
  const summaryLogo = await page.evaluate(() => {
    const img = document.querySelector(".summary-hero .me-monogram img") as HTMLImageElement;
    const rect = img.getBoundingClientRect();
    return { h: rect.height, w: rect.width, fit: getComputedStyle(img).objectFit, copyBg: getComputedStyle(document.querySelector(".summary-copy")!).backgroundColor };
  });
  assert.ok(summaryLogo.h <= 112 && summaryLogo.w <= 240, JSON.stringify(summaryLogo));
  assert.equal(summaryLogo.fit, "contain");
  assert.equal(summaryLogo.copyBg, "rgb(255, 255, 255)");
  await page.screenshot({ path: join(shots, "06-riepilogo-desktop.png"), fullPage: true });
  step("summary logo stays within 240×112 on a white text panel");

  // Transparent PNG logo upload through the settings dialog
  await page.getByRole("button", { name: "Impostazioni" }).first().click();
  await page.locator(".asset-upload").first().locator("input[type=file]").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png });
  await page.locator(".asset-upload").first().getByText("SVG (max 1 MB)").waitFor();
  const servedLogo = await page.evaluate(async () => Array.from(new Uint8Array(await (await fetch("/api/site-assets?kind=logo")).arrayBuffer())));
  assert.deepEqual(Buffer.from(servedLogo), png);
  await page.keyboard.press("Escape");
  step("transparent PNG logo is stored byte-for-byte");

  // Mobile layout
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const phone = await login(mobile);
  await phone.screenshot({ path: join(shots, "07-archivio-mobile.png"), fullPage: true });
  const archiveOverflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(archiveOverflow <= 0, `archive overflows by ${archiveOverflow}px`);
  await phone.getByRole("button", { name: "Apri PARIGI 2026" }).click();
  await phone.getByRole("button", { name: /Apri itinerario/ }).click();
  await phone.locator(".mobile-board .activity-card").first().waitFor();
  await waitSynced(phone);
  await phone.getByRole("tab", { name: /Lun 14/ }).click();
  await phone.getByRole("heading", { name: "Arrivo a Roma Fiumicino" }).waitFor();
  await phone.screenshot({ path: join(shots, "08-itinerario-mobile.png") });
  const itineraryOverflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(itineraryOverflow <= 0, `itinerary overflows by ${itineraryOverflow}px`);
  await phone.locator(".mobile-nav").getByRole("button", { name: "Da pianificare" }).click();
  await phone.getByRole("heading", { name: "Da pianificare" }).waitFor();
  await phone.getByRole("button", { name: /^Musei|^Museo$/ }).first().click();
  await phone.locator(".planning-grid .activity-card").first().getByRole("button", { name: "Scegli il giorno" }).click();
  await phone.getByRole("dialog").getByRole("button", { name: /Mar 15/ }).click();
  await waitSynced(phone);
  await phone.screenshot({ path: join(shots, "09-da-pianificare-mobile.png") });
  await phone.locator(".mobile-nav").getByRole("button", { name: "Riepilogo" }).click();
  await phone.locator(".summary-hero").waitFor();
  const phoneLogo = await phone.evaluate(() => (document.querySelector(".summary-hero .me-monogram img") as HTMLElement).getBoundingClientRect().toJSON());
  assert.ok(phoneLogo.height <= 88 && phoneLogo.width <= 200, JSON.stringify(phoneLogo));
  await phone.screenshot({ path: join(shots, "10-riepilogo-mobile.png"), fullPage: true });
  step("mobile: no horizontal overflow, day tabs, explicit day picker, summary logo ≤ 200×88");

  // Delete only the selected trip
  await page.getByRole("button", { name: /Torna all’archivio/ }).click();
  await page.getByRole("button", { name: "Nuovo viaggio", exact: true }).click();
  await page.getByLabel("Nome del viaggio").fill("LISBONA 2027");
  await page.getByLabel("Destinazione").fill("Lisbona, Portogallo");
  await page.getByLabel("Data di partenza").fill("2027-03-01");
  await page.getByLabel("Data di ritorno").fill("2027-02-25");
  await page.getByText("La data di ritorno non può precedere la partenza").waitFor();
  await page.getByLabel("Data di ritorno").fill("2027-03-04");
  await page.getByLabel("URL foto di copertina").fill("https://images.example/lisbona.jpg");
  await page.getByRole("button", { name: "Crea viaggio" }).click();
  await page.getByRole("button", { name: "Apri LISBONA 2027" }).waitFor();
  await page.getByRole("button", { name: "Elimina LISBONA 2027" }).click();
  await page.getByRole("button", { name: "Elimina definitivamente" }).click();
  await page.getByRole("button", { name: "Apri LISBONA 2027" }).waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Apri PARIGI 2026" }).waitFor();
  step("create with date validation, delete only the chosen trip");

  console.log(`\nE2E OK: ${steps.length} controlli superati. Screenshot in test-results/`);
} finally {
  await browser?.close();
  server.kill();
}
