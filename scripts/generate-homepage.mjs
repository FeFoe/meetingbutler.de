/**
 * Generates the meetingbutler.de SaaS homepage using Google Stitch SDK.
 * Output: designs/homepage/index.html + design.png
 *
 * Usage:
 *   STITCH_API_KEY=your_key node scripts/generate-homepage.mjs
 *
 * Or set GOOGLE_STITCH in .env and run:
 *   node scripts/generate-homepage.mjs
 */

import { stitch } from "@google/stitch-sdk";
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUT_DIR = resolve(ROOT, "designs/homepage");

// Load API key from .env if not set in environment
const apiKey =
  process.env.STITCH_API_KEY ||
  process.env.GOOGLE_STITCH ||
  (() => {
    try {
      const env = readFileSync(resolve(ROOT, ".env"), "utf8");
      const match = env.match(/GOOGLE_STITCH=(.+)/);
      return match?.[1]?.trim();
    } catch {
      return null;
    }
  })();

if (!apiKey) {
  console.error(
    "❌ Kein API Key gefunden. Bitte GOOGLE_STITCH in .env eintragen.\n" +
    "   API Key holen: https://stitch.withgoogle.com → Settings → API Keys"
  );
  process.exit(1);
}

// Set env so the SDK singleton picks it up
process.env.STITCH_API_KEY = apiKey;

const PROMPT = `
Design a modern, professional SaaS landing page for "Meetingbutler" — an AI-powered email-to-calendar service.

PRODUCT: Users forward meeting confirmation emails to meetings@meetingbutler.de. The AI automatically parses them and sends back a calendar invite (.ics file) ready to add to any calendar (Google, Outlook, Apple).

STYLE:
- Clean, minimal, premium SaaS aesthetic
- Dark navy/midnight blue primary color (#0f172a or similar)
- Accent color: electric blue or teal (#3b82f6 or #0ea5e9)
- White background sections with subtle gradients
- Modern sans-serif typography (Inter or similar)
- Generous whitespace

SECTIONS (in order):
1. NAVBAR: Logo "Meetingbutler" (left), nav links: Features, How It Works, Contact (right) + CTA button "Jetzt starten"
2. HERO: Large headline "Aus E-Mails werden Kalendertermine — automatisch." Subline "Leite Meeting-Bestätigungen einfach weiter. Meetingbutler erkennt die Details und schickt dir sofort eine Kalendereinladung." Big CTA button. Subtle email → calendar animation/illustration concept.
3. HOW IT WORKS: 3-step process with icons:
   Step 1: "E-Mail weiterleiten" — Du bekommst eine Meeting-Bestätigung? Leite sie an meetings@meetingbutler.de weiter.
   Step 2: "KI liest die Details" — Meetingbutler erkennt automatisch Datum, Uhrzeit, Ort und Teilnehmer.
   Step 3: "Kalender-Einladung erhalten" — Sekunden später landet eine .ics-Datei in deinem Postfach. Ein Klick — im Kalender.
4. FEATURES: 3-column grid with icons:
   - "Funktioniert mit jedem Kalender" (Google, Outlook, Apple Calendar)
   - "Kein Account nötig" (einfach weiterleiten, keine Registrierung erforderlich)
   - "Deutsche Datenschutzstandards" (Server in Deutschland, DSGVO-konform)
5. FINAL CTA: "Bereit, Meeting-Chaos zu beenden?" with email input field + "Loslegen" button. Subtext: "Kostenlos starten. Keine Kreditkarte erforderlich."
6. FOOTER: Logo + copyright + links (Impressum, Datenschutz)

LANGUAGE: German
DEVICE: Desktop (full-width)
`.trim();

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log("🎨 Erstelle Stitch-Projekt...");
  const project = await stitch.createProject("Meetingbutler Homepage");
  console.log(`   Projekt-ID: ${project.id}`);

  console.log("⚙️  Generiere Homepage (DESKTOP)...");
  const screen = await project.generate(PROMPT, "DESKTOP", "GEMINI_3_PRO");
  console.log(`   Screen-ID: ${screen.id}`);

  console.log("📥 Lade HTML herunter...");
  const htmlUrl = await screen.getHtml();
  const htmlRes = await fetch(htmlUrl);
  const html = await htmlRes.text();
  writeFileSync(resolve(OUT_DIR, "index.html"), html, "utf8");
  console.log("   ✅ designs/homepage/index.html gespeichert");

  console.log("📥 Lade Screenshot herunter...");
  const imgUrl = await screen.getImage();
  const imgRes = await fetch(imgUrl);
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  writeFileSync(resolve(OUT_DIR, "design.png"), imgBuffer);
  console.log("   ✅ designs/homepage/design.png gespeichert");

  // Save metadata for reference
  const meta = {
    projectId: project.id,
    screenId: screen.id,
    generatedAt: new Date().toISOString(),
    htmlUrl,
    imgUrl,
  };
  writeFileSync(resolve(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2));

  console.log("\n✅ Fertig! Öffne designs/homepage/index.html im Browser.");
  console.log(`   Projekt: https://stitch.withgoogle.com/project/${project.id}`);
}

main().catch((err) => {
  console.error("❌ Fehler:", err.message || err);
  process.exit(1);
});
