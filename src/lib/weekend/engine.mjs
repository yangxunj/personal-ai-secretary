/** Hong Kong weekend event rules shared by platform adapters. Source data is untrusted. */
export const SOURCES = {
  hktb: { label: '香港旅游发展局', url: 'https://www.discoverhongkong.com/tc/what-s-new/events.html' },
  hkpl: { label: '香港公共图书馆', url: 'https://www.hkpl.gov.hk/tc/extension-activities/all-events/this-week' },
  lcsdm: { label: '康文署博物馆', url: 'https://www.museums.gov.hk/tc/web/portal/what-s-on.html' },
};
export const strip = text => String(text || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/\s+/g, ' ').trim();
const iso = d => d.toISOString().slice(0, 10);
function validDay(value) {
  const m = String(value || '').match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return null;
  const date = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return date.getUTCFullYear() === +m[1] && date.getUTCMonth() === +m[2] - 1 && date.getUTCDate() === +m[3] ? iso(date) : null;
}
export function weekendFor(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const part = type => parts.find(p => p.type === type).value;
  const today = new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00Z`);
  const weekday = today.getUTCDay();
  today.setUTCDate(today.getUTCDate() + (weekday === 0 ? -1 : 6 - weekday));
  const sunday = new Date(today.getTime() + 86400000);
  return [iso(today), iso(sunday)];
}
function validUrl(value, base) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try { const url = new URL(value, base); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; } catch { return null; }
}
function extractHktb(text) {
  const index = text.indexOf('"startDate"');
  if (index < 0) throw new Error('页面结构发生变化');
  let pos = index, best = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    pos = text.lastIndexOf('[{', pos - 1); if (pos < 0) break;
    let depth = 0, quoted = false, escaped = false, end = -1;
    for (let j = pos; j < text.length; j++) {
      const char = text[j];
      if (escaped) { escaped = false; continue; }
      if (char === '\\') { escaped = true; continue; }
      if (char === '"') { quoted = !quoted; continue; }
      if (quoted) continue;
      if (char === '[' || char === '{') depth++;
      else if (char === ']' || char === '}') { if (--depth === 0) { end = j + 1; break; } }
    }
    if (end < 0) continue;
    try { const value = JSON.parse(text.slice(pos, end)); if (Array.isArray(value) && value[0]?.startDate) best = value; } catch { /* continue outward */ }
  }
  if (!best) throw new Error('无法识别活动数据');
  return best;
}
export function parseHktb(text) {
  const weights = { 親子: 4, 寓教於樂: 3, '博物館、藝廊或公共空間': 2, 節慶活動: 1, 藝術展: 1, 商場活動: 1, 演唱會: -5, 時裝: -4, 音樂會: -3, 舞台製作: -2 };
  return extractHktb(text).map(event => {
    const start = validDay(event.startDate), end = validDay(event.endDate || event.startDate), cats = Array.isArray(event.eventCategories) ? event.eventCategories : [];
    if (!start || !end || end < start || !event.title) return null;
    const destination = event.pageUrl || (event.website && !/^https?:/i.test(event.website) ? 'https://' + event.website : event.website);
    return { source: 'hktb', title: strip(event.title), start, end, venue: strip(event.addr), time: '', url: validUrl(destination, SOURCES.hktb.url), description: strip(event.description), family: cats.includes('親子') || cats.includes('寓教於樂'), score: cats.reduce((n, cat) => n + (weights[cat] || 0), 0) };
  }).filter(Boolean);
}
const KID = /兒童|儿童|親子|亲子|幼兒|幼儿|小童|故事時間|故事时间|小小|少年|中小學|中小学|小學|小学|漫畫|漫画|繪本|绘本|手作|手工/;
const DISPLAY = /書籍介紹|书籍介绍|書籍展覽|书籍展览|資源選介|资源选介|書籍推介|书籍推介/;
export function parseHkpl(text) {
  const rows = [];
  for (const block of text.split('<div class="event_in_series">').slice(1)) {
    const title = block.match(/<a href="(\/tc\/extension-activities\/event-detail\/[^"]+)"[^>]*>\s*<span class="word_c">([^<]+)</);
    const dates = block.match(/class="date_de detail">([^<]*)</);
    if (!title || !dates) continue;
    const days = [...dates[1].matchAll(/(\d{4})年(\d{1,2})月(\d{1,2})日/g)].map(m => validDay(`${m[1]}-${m[2]}-${m[3]}`)).filter(Boolean);
    if (!days.length) continue;
    const name = strip(title[2]), time = strip(block.match(/class="time_de detail">([^<]*)</)?.[1]);
    const family = KID.test(name), display = DISPLAY.test(name);
    const score = (family ? 5 : 0) + (/工作坊|體驗|体验|導賞|导赏|參觀|参观|示範|示范/.test(name) ? 2 : 0) - (/講座|讲座|研討|研讨|職場|职场|理財|理财|長者|长者|成人組|成人组/.test(name) && !family ? 3 : 0) - (display ? 4 : 0);
    rows.push({ source: 'hkpl', title: name, start: days[0], end: days.at(-1), time: /開放時間|开放时间/.test(time) ? '' : time, venue: strip(block.match(/class="venue_de detail">([\s\S]*?)<\/td>/)?.[1]), url: validUrl(title[1], 'https://www.hkpl.gov.hk'), description: '', family, display, score });
  }
  return rows;
}
export function hkplPageCount(text) {
  const counts = [...text.matchAll(/之\s*(\d+)/g)].map(m => +m[1]).filter(n => n > 0 && n < 200);
  return counts.length ? Math.max(...counts) : 1;
}
export function parseLcsdm(text) {
  const venueScores = { ScM: 5, SciM: 5, SpM: 5, MH: 2, HM: 2, MoA: 2, MT: 2, MA: 1, FA: 1, 'Oi!': 1, OI: 1, APO: 1 };
  const cats = { Science: 4, History: 2, Heritage: 2, Culture: 2, Art: 1, Arts: 1, ART: 1, Fest: 2 };
  // Some descriptions contain raw newlines, so one event may span several
  // physical lines. A record begins with a display date followed by a tab.
  const records = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\d{4}[/-]\d{1,2}[/-]\d{1,2}\t/.test(line)) records.push(line);
    else if (records.length) records[records.length - 1] += '\n' + line;
  }
  return records.map(line => line.split('\t')).filter(row => row.length > 22).map(row => {
    const start = validDay(row[2]?.trim()) || validDay(row[0]?.trim()), end = validDay(row[3]?.trim()) || validDay(row[1]?.trim()) || start;
    const title = strip(row[13]) || strip(row[8]), venue = strip(row[15]) || strip(row[10]);
    if (!start || !end || end < start || !title) return null;
    const family = /兒童|儿童|親子|亲子|恐龍|恐龙|太空|宇宙|動物|动物|昆蟲|昆虫|玩具|遊戲|游戏|科學|科学|互動|互动|漫畫|漫画/.test(title + venue);
    return { source: 'lcsdm', title, start, end, venue, time: '', url: validUrl(strip(row[17]) || strip(row[12]), SOURCES.lcsdm.url), description: strip(row[14]), family, score: (venueScores[row[6]?.trim()] || 1) + (cats[row[4]?.trim()] || 0) + (family ? 2 : 0) };
  }).filter(Boolean);
}
export function projectWeekend(events, saturday, sunday) {
  if (!validDay(saturday) || !validDay(sunday) || saturday > sunday) throw new Error('周末日期无效');
  const seen = new Set();
  const selected = events.filter(row => row.start <= sunday && row.end >= saturday).filter(row => {
    const key = row.title + '|' + row.venue.slice(0, 12); if (seen.has(key)) return false; seen.add(key); return true;
  });
  const excludedShelves = selected.filter(row => row.display).length;
  const groups = new Map();
  for (const row of selected.filter(row => !row.display)) {
    const timed = !!row.time && row.start >= saturday && row.start <= sunday;
    const key = row.source + '|' + row.title + '|' + timed;
    if (!groups.has(key)) groups.set(key, { ...row, spots: [] });
    const group = groups.get(key); group.spots.push({ venue: row.venue, time: row.time, start: row.start, end: row.end, url: row.url });
    group.score = Math.max(group.score, row.score); group.family ||= row.family;
    if (row.start < group.start) group.start = row.start;
    if (row.end > group.end) group.end = row.end;
  }
  const rows = [...groups.values()].sort((a, b) => Number(!!b.time) - Number(!!a.time) || b.score - a.score || a.end.localeCompare(b.end));
  for (const row of rows) row.spots.sort((a, b) => a.start.localeCompare(b.start) || String(a.time).localeCompare(String(b.time)));
  return { saturday, sunday, excludedShelves, rows };
}

export function groupWeekend(rows, saturday, sunday) {
  const timed = [], ending = [], family = [], other = [];
  const cutoff = new Date(`${sunday}T00:00:00Z`); cutoff.setUTCDate(cutoff.getUTCDate() + 2);
  for (const row of rows) {
    if (row.spots.some(spot => spot.time && spot.start >= saturday && spot.start <= sunday)) timed.push(row);
    else if (row.end <= iso(cutoff)) ending.push(row);
    else if (row.score >= 3) family.push(row);
    else other.push(row);
  }
  ending.sort((a, b) => a.end.localeCompare(b.end));
  return { groups: [{ title: '这个周末有固定时间', rows: timed }, { title: '即将结束', rows: ending }, { title: '可能适合家庭', rows: family }, { title: '其他活动', rows: other.slice(0, 50) }], omitted: Math.max(0, other.length - 50) };
}
