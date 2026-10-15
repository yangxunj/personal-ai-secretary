import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const load = async (file) => import('data:text/javascript;base64,' + Buffer.from(ts.transpileModule(
  readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } },
).outputText).toString('base64'));
const { TurnDetector } = await load('../src/lib/turn-detector.ts');
const session = await load('../src/lib/voice-session.ts');
const frame = (level, rate = 16000) => new Float32Array(rate * 0.02).fill(level);
const feed = (detector, level, count, rate) => Array.from({ length: count }, () => detector.push(frame(level, rate)));

test('silence and short clicks never submit a voice turn', () => {
  const detector = new TurnDetector(16000);
  assert.ok(feed(detector, 0, 1000).every(e => !e.audio && !e.started));
  feed(detector, 0.1, 5);
  assert.ok(feed(detector, 0, 100).every(e => !e.audio));
  feed(detector, 0.1, 7);
  const rejected = feed(detector, 0, 100);
  assert.ok(rejected.some(e => e.discarded)); assert.ok(rejected.every(e => !e.audio));
});

test('speech keeps its first samples, waits for the pause and emits exactly once', () => {
  const detector = new TurnDetector(16000);
  feed(detector, 0, 25);
  const speech = feed(detector, 0.08, 40);
  assert.equal(speech.filter(e => e.started).length, 1);
  assert.ok(feed(detector, 0, 59).every(e => !e.audio));
  const ended = detector.push(frame(0));
  assert.ok(ended.audio); assert.ok(ended.audio.some(v => v > 0.07));
  assert.equal(ended.audio.filter(v => v > 0.07).length, 40 * 320);
  assert.ok(ended.audio.length < 16000 * 1.5);
  assert.ok(feed(detector, 0, 200).every(e => !e.audio));
  feed(detector, 0.09, 30);
  assert.equal(feed(detector, 0, 60).filter(e => e.audio).length, 1);
});

test('brief internal pauses stay in one turn; maximum length is bounded at native rates', () => {
  for (const rate of [16000, 44100, 48000]) {
    const detector = new TurnDetector(rate);
    feed(detector, 0.05, 25, rate); feed(detector, 0, 20, rate); feed(detector, 0.05, 25, rate);
    assert.equal(feed(detector, 0, 60, rate).filter(e => e.audio).length, 1);
    detector.reset();
    const ended = feed(detector, 0.1, 3000, rate).find(e => e.audio);
    assert.ok(ended?.limit); assert.ok(ended.audio.length <= rate * 60);
  }
});

test('reset discards pre-roll and prevents old audio entering a later turn', () => {
  const detector = new TurnDetector(16000);
  feed(detector, 0.2, 40); detector.reset();
  feed(detector, 0.05, 30);
  const audio = feed(detector, 0, 60).find(e => e.audio).audio;
  assert.ok(audio.every(v => v < 0.1));
});

test('worklet mixes mono PCM into 20ms packets and always outputs silence', () => {
  let Processor;
  const packets = [];
  runInNewContext(readFileSync(new URL('../public/worklets/voice-capture.js', import.meta.url), 'utf8'), {
    AudioWorkletProcessor: class { port = { postMessage: value => packets.push(value) }; },
    Float32Array, sampleRate: 48000, registerProcessor: (_name, processor) => { Processor = processor; },
  });
  const node = new Processor();
  for (let i = 0; i < 15; i++) {
    const out = new Float32Array(128).fill(1);
    assert.equal(node.process([[new Float32Array(128).fill(0.2), new Float32Array(128).fill(0.4)]], [[out]]), true);
    assert.ok(out.every(v => v === 0));
  }
  assert.equal(packets.length, 2); assert.equal(packets[0].length, 960);
  assert.ok(packets[0].every(v => Math.abs(v - 0.3) < 0.0001));
});

test('a new continuous session closes the old owner; late cleanup cannot close the new one', () => {
  const first = {}, second = {}; let stopped = 0, changed = 0;
  const unsubscribe = session.subscribeVoiceSession(() => changed++);
  session.beginVoiceSession(first, () => { stopped++; session.endVoiceSession(first); });
  session.beginVoiceSession(second, () => {});
  assert.equal(stopped, 1); assert.equal(session.voiceSessionOwner(), second);
  session.endVoiceSession(first); assert.equal(session.voiceSessionOwner(), second);
  session.endVoiceSession(second); assert.equal(session.voiceSessionOwner(), null);
  assert.ok(changed >= 3); unsubscribe();
});
