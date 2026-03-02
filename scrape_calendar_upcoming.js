// scrape_calendar_upcoming.js
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs-extra");
const path = require("path");

function clean(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function ymd(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHtml(url) {
  const { data } = await axios.get(url, {
    timeout: 30000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Connection: "keep-alive",
    },
  });
  return data;
}

async function scrapeListing(startDate, endDate) {
  const url = `https://www.du.edu/calendar?start_date=${startDate}&end_date=${endDate}&search=`;
  const html = await fetchHtml(url);
  const $ = cheerio.load(html);

  const links = new Set();

  // Important: DU calendar can use relative OR absolute links
  $("a[href]").each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;

    if (href.startsWith("/events/")) links.add(`https://www.du.edu${href}`);
    else if (href.startsWith("https://www.du.edu/events/")) links.add(href);
  });

  return Array.from(links);
}

async function scrapeEventPage(eventUrl) {
  const html = await fetchHtml(eventUrl);
  const $ = cheerio.load(html);

  const title = clean($("h1").first().text());
  const mainText = clean($("main").text()) || clean($("body").text());

  // Time range like "7:30pm - 9:00pm"
  const timeMatch = mainText.match(
    /\b\d{1,2}:\d{2}\s?(?:am|pm)\s?-\s?\d{1,2}:\d{2}\s?(?:am|pm)\b/i
  );
  const time = timeMatch ? clean(timeMatch[0]) : null;

  // Date like "March 12"
  const dateMatch = mainText.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b/
  );
  const date = dateMatch ? clean(dateMatch[0]) : "";

  // Description chunk: between title and "Add to Calendar" (best generic heuristic)
  let description = "";
  if (title) {
    const idxTitle = mainText.indexOf(title);
    const idxAdd = mainText.toLowerCase().indexOf("add to calendar");
    if (idxTitle !== -1 && idxAdd !== -1 && idxAdd > idxTitle) {
      description = clean(mainText.slice(idxTitle + title.length, idxAdd));
    }
  }

  const eventObj = { title, date };
  if (time) eventObj.time = time;
  if (description) eventObj.description = description;

  return eventObj;
}

async function main() {
  await fs.ensureDir("results");

  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const monthsToScrape = 12;
  const allEventUrls = new Set();

  for (let i = 0; i < monthsToScrape; i++) {
    const mStart = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const mEnd = new Date(start.getFullYear(), start.getMonth() + i + 1, 1);

    const startDate = i === 0 ? ymd(start) : ymd(mStart);
    const endDate = ymd(mEnd);

    console.log(`Listing: ${startDate} -> ${endDate}`);
    const urls = await scrapeListing(startDate, endDate);
    urls.forEach((u) => allEventUrls.add(u));

    await sleep(200);
  }

  const urls = Array.from(allEventUrls);
  console.log(`Found ${urls.length} unique event pages`);

  const events = [];
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    console.log(`(${i + 1}/${urls.length}) ${u}`);
    try {
      const evt = await scrapeEventPage(u);
      if (evt.title && evt.date) events.push(evt);
    } catch (e) {
      // skip failures
    }
    await sleep(200);
  }

  const outPath = path.join("results", "calendar_events.json");
  await fs.writeJson(outPath, { events }, { spaces: 4 });

  console.log(`Wrote ${events.length} events -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});