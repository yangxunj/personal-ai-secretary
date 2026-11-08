import { weekendFor, parseHktb, parseHkpl, parseLcsdm, hkplPageCount, projectWeekend, SOURCES } from './engine.mjs';

/** The adapter accepts only source identifiers and numeric paging parameters. */
export async function loadWeekend(adapter, now = new Date()) {
  const [saturday, sunday] = weekendFor(now);
  const reports = [];
  const jobs = [
    ['hktb', async () => {
      const raw = await adapter.get({ source: 'hktb' });
      const rows = parseHktb(raw); if (!rows.length) throw new Error('未识别到活动'); return rows;
    }],
    ['hkpl', async () => {
      const months = [...new Set([saturday.slice(0, 7), sunday.slice(0, 7)])], rows = [];
      for (const month of months) {
        const [year, number] = month.split('-').map(Number);
        const first = await adapter.get({ source: 'hkpl', year, month: number, page: 1 });
        const pages = hkplPageCount(first);
        if (pages > 45) throw new Error('分页超过安全上限');
        const firstRows = parseHkpl(first);
        if (!firstRows.length) throw new Error('未识别到活动');
        rows.push(...firstRows);
        let next = 2, stopped = false;
        const worker = async () => {
          while (!stopped && next <= pages) {
            try {
              const page = next++;
              const result = parseHkpl(await adapter.get({ source: 'hkpl', year, month: number, page }));
              if (!result.length) throw new Error('分页中未识别到活动');
              rows.push(...result);
            } catch (error) { stopped = true; throw error; }
          }
        };
        await Promise.all(Array.from({ length: Math.min(4, pages - 1) }, worker));
      }
      return rows;
    }],
    ['lcsdm', async () => {
      const rows = parseLcsdm(await adapter.get({ source: 'lcsdm' }));
      if (!rows.length) throw new Error('未识别到活动'); return rows;
    }],
  ];
  const results = await Promise.all(jobs.map(async ([source, run]) => {
    try { const events = await run(); reports.push({ source, ok: true, count: events.length }); return events; }
    catch { reports.push({ source, ok: false, count: 0 }); return []; }
  }));
  reports.sort((a, b) => Object.keys(SOURCES).indexOf(a.source) - Object.keys(SOURCES).indexOf(b.source));
  if (!reports.some(report => report.ok)) throw new Error('三个来源均未能读取，请检查网络后重试。');
  return { ...projectWeekend(results.flat(), saturday, sunday), generatedAt: now.toISOString(), reports };
}
