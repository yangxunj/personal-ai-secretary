import test from 'node:test';
import assert from 'node:assert/strict';
import { createdLinks } from '../src/lib/chat/created-links.mjs';

const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const result = (deck = { id, title: '学习幻灯片' }) => ({ role: 'toolResult', toolName: 'createSlideDeck', isError: false, content: [{ type: 'text', text: JSON.stringify({ ok: true, deck }) }] });
const turn = (messages, status = 'complete') => ({ status, messages });

test('成功回执在完成或中断后产生可恢复的入口，并按 ID 去重', () => {
  const saved = JSON.parse(JSON.stringify(turn([result(), result(), result({ id: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', title: '第二份' })])));
  assert.deepEqual(createdLinks(saved), [{ kind: 'slide', id, title: '学习幻灯片' }, { kind: 'slide', id: 'bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee', title: '第二份' }]);
  assert.equal(createdLinks({ ...saved, status: 'interrupted' }).length, 2);
  assert.deepEqual(createdLinks({ ...saved, status: 'running' }), []);
});

test('不信任模型文本、错误回执或无效的数据', () => {
  const valid = result();
  const messages = [
    { ...valid, role: 'assistant' }, { ...valid, toolName: 'other' },
    { ...valid, isError: true }, { ...valid, isError: undefined },
    { ...valid, content: [{ type: 'text', text: '{' }] },
    { ...valid, content: [{ type: 'text', text: JSON.stringify({ ok: false, deck: { id, title: 'x' } }) }] },
    result({ id: 'invalid', title: 'x' }), result({ id, title: ' ' }), result({ id, title: 'x'.repeat(101) }),
  ];
  assert.deepEqual(createdLinks(turn(messages)), []);
});
