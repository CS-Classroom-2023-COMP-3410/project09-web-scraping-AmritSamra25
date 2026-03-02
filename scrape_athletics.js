// scrape_athletics.js
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs-extra");
const path = require("path");

const URL = "https://denverpioneers.com/";

function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function uniqBy(arr, keyFn) {
  const seen = new Set();
  return arr.filter((x) => {
    const k = keyFn(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function main() {
  await fs.ensureDir("results");

  const { data: html } = await axios.get(URL, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
    timeout: 30000,
  });

  const $ = cheerio.load(html);

  // Try a few common Sidearm patterns for the top scoreboard/hero carousel
  const candidateSelectors = [
    ".sidearm-scoreboard .sidearm-scoreboard-game",
    ".scoreboard .scoreboard__game",
    ".scoreboard .scoreboard__item",
    ".rotator .slide",
    ".hero-rotator .slide",
    "[class*='scoreboard'] [class*='game']",
    "[class*='scoreboard'] [class*='item']",
  ];

  let $cards = null;
  for (const sel of candidateSelectors) {
    const found = $(sel);
    if (found.length) {
      $cards = found;
      break;
    }
  }

  const events = [];

  if ($cards && $cards.length) {
    $cards.each((_, el) => {
      const node = $(el);

      // Best-effort extraction; templates vary
      const duTeam =
        clean(node.find("[class*='home']").text()) ||
        clean(node.find("[class*='team-name']").first().text()) ||
        "Denver";

      const opponent =
        clean(node.find("[class*='away']").text()) ||
        clean(node.find("[class*='opponent']").text()) ||
        clean(node.find("[class*='vs']").text());

      const date =
        clean(node.find("time").attr("datetime")) ||
        clean(node.find("time").text()) ||
        clean(node.find("[class*='date']").text()) ||
        clean(node.find("[class*='game-date']").text());

      if (opponent && date) {
        events.push({
          duTeam: duTeam || "Denver",
          opponent,
          date,
        });
      }
    });
  }

  const finalEvents = uniqBy(
    events.map((e) => ({
      duTeam: clean(e.duTeam || "Denver"),
      opponent: clean(e.opponent),
      date: clean(e.date),
    })),
    (e) => `${e.duTeam}||${e.opponent}||${e.date}`
  );

  const outPath = path.join("results", "athletic_events.json");
  await fs.writeJson(outPath, { events: finalEvents }, { spaces: 4 });

  console.log(`Wrote ${finalEvents.length} events -> ${outPath}`);

  if (!finalEvents.length) {
    console.log(
      "Got 0. This means the homepage carousel data is likely injected by JS or uses different classes. Inspect the top carousel in DevTools and update candidateSelectors + inner selectors."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});