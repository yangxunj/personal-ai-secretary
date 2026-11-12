import { test } from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createNativeMicrophone } from './web/native-microphone.mjs';

function fixture() {
  const host = { crypto: webcrypto, atob }, calls = [];
  const bridge = {
    startNativeMicrophone(id) { calls.push(['start', id]); },
    stopNativeMicrophone(id) { calls.push(['stop', id]); },
    setNativeMicrophoneListening(id, value) { calls.push(['listening', id, value]); },
    acknowledgeNativeMicrophone(id) { calls.push(['ack', id]); },
  };
  return { host, calls, microphone: createNativeMicrophone(host, bridge) };
}
test('native PCM is forwarded only during listening and stopped on exit', async () => {
  const { host, calls, microphone } = fixture(), frames = [], controller = new AbortController();
  const request = microphone.start(controller.signal, frame => frames.push(frame), () => assert.fail('unexpected error'));
  const id = calls[0][1]; host.SecretaryMicrophone.receive(id, 'ready', '16000');
  const session = await request; assert.equal(session.sampleRate, 16000);
  host.SecretaryMicrophone.receive(id, 'audio', 'AIAAQA==');
  assert.equal(frames.length, 0);
  session.setListening(true);
  host.SecretaryMicrophone.receive(id, 'audio', 'AIAAQA==');
  assert.deepEqual([...frames[0]], [-1, 0.5]);
  session.setListening(false);
  host.SecretaryMicrophone.receive(id, 'audio', 'AIAAQA==');
  assert.equal(frames.length, 1); assert.equal(calls.filter(call => call[0] === 'ack').length, 3);
  session.stop(); assert.deepEqual(calls.at(-1), ['stop', id]);
  host.SecretaryMicrophone.receive(id, 'audio', 'AIAAQA=='); assert.equal(frames.length, 1);
});
test('aborted startup stops native capture and ignores late ready', async () => {
  const { host, calls, microphone } = fixture(), controller = new AbortController();
  const request = microphone.start(controller.signal, () => {}, () => {}), id = calls[0][1];
  controller.abort(); await assert.rejects(request, { name: 'AbortError' });
  assert.deepEqual(calls.at(-1), ['stop', id]); host.SecretaryMicrophone.receive(id, 'ready', '16000');
});
test('malformed native PCM stops the active capture and reports failure', async () => {
  const { host, calls, microphone } = fixture(); let errors = 0;
  const request = microphone.start(new AbortController().signal, () => {}, () => errors++), id = calls[0][1];
  host.SecretaryMicrophone.receive(id, 'ready', '16000'); const session = await request; session.setListening(true);
  host.SecretaryMicrophone.receive(id, 'audio', 'AQ==');
  assert.equal(errors, 1); assert.ok(calls.some(call => call[0] === 'stop' && call[1] === id));
});
