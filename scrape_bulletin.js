// scrape_bulletin.js
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs-extra");
const path = require("path");

const URL = "https://bulletin.du.edu/undergraduate/coursedescriptions/comp/";

function normalizeSpace(s) {
  return (s || "").replace(/\s+/g, " ").trim();
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

  // Bulletin pages are very consistent in rendered text; parse in text mode.
  const text = normalizeSpace($("body").text());

  // Matches: "COMP 3352 Elements of Compiler Design (4 Credits)"
  const courseHeaderRe =
    /COMP\s+(\d{4})\s+(.+?)\s+\((?:\d+(?:-\d+)?\s+Credits?|[^\)]*Credits?)\)/g;

  const matches = [];
  for (let m; (m = courseHeaderRe.exec(text)); ) {
    matches.push({
      num: parseInt(m[1], 10),
      title: m[2].trim(),
      index: m.index,
    });
  }

  const courses = [];

  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const nextIndex = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const block = text.slice(cur.index, nextIndex);

    const isUpper = cur.num >= 3000;
    const hasPrereq = /Prerequisite/i.test(block);

    if (isUpper && !hasPrereq) {
      courses.push({
        course: `COMP-${String(cur.num).padStart(4, "0")}`,
        title: cur.title,
      });
    }
  }

  const outPath = path.join("results", "bulletin.json");
  await fs.writeJson(outPath, { courses }, { spaces: 4 });

  console.log(`Wrote ${courses.length} courses -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});