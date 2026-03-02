// scrape_athletics.js
// Scrapes DU Athletics "Live Events" page for upcoming events and writes results/athletic_events.json

const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs-extra");

const OUTPUT_PATH = "results/athletic_events.json";
const LIVE_EVENTS_URL = "https://denverpioneers.com/coverage";

/**
 * Extract opponent name from strings like:
 *  - "Women's Lacrosse at Stony Brook"
 *  - "Men's Ice Hockey vs Miami"
 *  - "Women's Basketball vs Semifinals"
 */
function parseOpponent(text) {
  const cleaned = (text || "").replace(/\s+/g, " ").trim();

  // Try " vs " first, then " at "
  const vsIdx = cleaned.toLowerCase().lastIndexOf(" vs ");
  if (vsIdx !== -1) return cleaned.slice(vsIdx + 4).trim();

  const atIdx = cleaned.toLowerCase().lastIndexOf(" at ");
  if (atIdx !== -1) return cleaned.slice(atIdx + 4).trim();

  // Fallback: if no delimiter, just return the whole thing (better than blank)
  return cleaned;
}

/**
 * Normalize date header like:
 * "Friday, March 6 3/6/2026" -> keep whole thing
 */
function normalizeDateHeader(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

async function fetchHtml(url) {
  const res = await axios.get(url, {
    headers: {
      // Helps avoid some simplistic bot blocks
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    timeout: 20000,
    maxRedirects: 5,
  });
  return res.data;
}

async function scrapeLiveEvents() {
  const html = await fetchHtml(LIVE_EVENTS_URL);
  const $ = cheerio.load(html);

  // Sidearm pages usually render a table for live events.
  // We'll grab the first table that looks like the live events list.
  let table =
    $("table").filter((_, el) => {
      const t = $(el).text().toLowerCase();
      return t.includes("live events") || (t.includes("sport") && t.includes("opponent"));
    }).first();

  if (!table || table.length === 0) {
    // fallback: just use the first table on page
    table = $("table").first();
  }

  const events = [];

  // The page groups events by date (header rows) then event rows.
  // We track the current date header as we walk rows.
  let currentDate = "";

  const rows = table.find("tr");
  rows.each((_, row) => {
    const $row = $(row);

    // Pull all cells text
    const cells = $row.find("th, td");
    const cellTexts = cells
      .map((__, c) => $(c).text().replace(/\s+/g, " ").trim())
      .get()
      .filter(Boolean);

    if (cellTexts.length === 0) return;

    const joined = cellTexts.join(" ").toLowerCase();

    // Detect date header rows:
    // Often a date header row contains day+month+year formats and not "tv/radio"
    // We can key off weekday names.
    const isDateHeader =
      joined.includes("monday") ||
      joined.includes("tuesday") ||
      joined.includes("wednesday") ||
      joined.includes("thursday") ||
      joined.includes("friday") ||
      joined.includes("saturday") ||
      joined.includes("sunday");

    // If it’s a date header row, store it and move on.
    if (isDateHeader && cellTexts.length <= 3) {
      currentDate = normalizeDateHeader(cellTexts.join(" "));
      return;
    }

    // Now parse an event row.
    // Typical columns: Time | Sport | Opponent | TV | Radio | ...
    // But sometimes time is blank and shifts left.
    // We'll try to locate "Sport" and "Opponent" intelligently.

    // Heuristic:
    // - sport usually looks like "Men's Ice Hockey" or "Women's Lacrosse"
    // - opponent cell often contains "vs" or "at"
    let time = "";
    let sport = "";
    let opponentRaw = "";

    // If first cell looks like a time (contains "am" or "pm" or ":"), treat as time.
    const first = cellTexts[0] || "";
    if (/(am|pm)\b/i.test(first) || first.includes(":")) {
      time = first;
      sport = cellTexts[1] || "";
      opponentRaw = cellTexts[2] || "";
    } else {
      // time missing, shift
      sport = cellTexts[0] || "";
      opponentRaw = cellTexts[1] || "";
    }

    // If opponentRaw is empty, try to find a cell that contains " vs " or " at "
    if (!opponentRaw) {
      const candidate = cellTexts.find((t) => /\s(vs|at)\s/i.test(t));
      if (candidate) opponentRaw = candidate;
    }

    // If sport looks wrong (like "Streaming Video - ..."), skip
    if (!sport || sport.toLowerCase().includes("streaming")) return;

    // If opponentRaw is still empty, skip (better than garbage)
    if (!opponentRaw) return;

    const opponent = parseOpponent(opponentRaw);

    // Date should be available; if not, still output something
    const date = currentDate || "";

    events.push({
      duTeam: sport.trim(),
      opponent,
      date: date.trim() + (time ? ` ${time}` : ""),
    });
  });

  // De-dupe (same sport/opponent/date)
  const seen = new Set();
  const unique = [];
  for (const e of events) {
    const key = `${e.duTeam}|||${e.opponent}|||${e.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(e);
  }

  return unique;
}

async function main() {
  await fs.ensureDir("results");

  try {
    const events = await scrapeLiveEvents();

    await fs.writeJson(OUTPUT_PATH, { events }, { spaces: 4 });

    console.log(`Wrote ${events.length} events -> ${OUTPUT_PATH}`);
    if (events.length === 0) {
      console.log(
        "Got 0. If this happens, open https://denverpioneers.com/coverage in a browser and check if the table HTML changed."
      );
    }
  } catch (err) {
    console.error("Scrape failed:", err.message);
    process.exitCode = 1;
  }
}

main();