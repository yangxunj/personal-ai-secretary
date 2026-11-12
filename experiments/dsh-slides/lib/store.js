import { randomUUID } from 'node:crypto';
import { mkdirSync, openSync, closeSync, writeFileSync, readFileSync, readdirSync, renameSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createSlideDeckInput } from './contracts.js';
import { splitPages } from './views.js';

const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createStore(directory = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'secretary-slides-pilot')) {
  function read(id) {
    if (typeof id !== 'string' || !validId.test(id)) return null;
    try {
      const row = JSON.parse(readFileSync(join(directory, `${id}.json`), 'utf8'));
      const input = createSlideDeckInput.parse({ title: row.title, markdown: row.markdown });
      if (row.id !== id || !Number.isSafeInteger(row.createdAt)) return null;
      return { id, ...input, createdAt: row.createdAt };
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  function list() {
    let names;
    try { names = readdirSync(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    return names.filter(name => name.endsWith('.json') && validId.test(name.slice(0, -5)))
      .map(name => read(name.slice(0, -5))).filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
  }
  function create(args) {
    const input = createSlideDeckInput.parse(args);
    if (!splitPages(input.markdown).length) throw new Error('幻灯片没有可显示的内容。');
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const deck = { id: randomUUID(), ...input, createdAt: Date.now() };
    const temp = join(directory, `${deck.id}.tmp`), dest = join(directory, `${deck.id}.json`);
    const fd = openSync(temp, 'wx', 0o600);
    try { try { writeFileSync(fd, JSON.stringify(deck), 'utf8'); } finally { closeSync(fd); } renameSync(temp, dest); }
    catch (error) { try { unlinkSync(temp); } catch {} throw error; }
    return deck;
  }
  return { create, list, read };
}
