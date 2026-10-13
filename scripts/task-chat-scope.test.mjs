import test from 'node:test';import assert from 'node:assert/strict';
import {taskPatch} from '../src/lib/task-chat-scope.mjs';
test('another task id cannot be written even with a valid patch',()=>{
  assert.throws(()=>taskPatch('task-a',{id:'task-b',status:'done'}),/current task/);
});
test('original requirements cannot be overwritten even alongside allowed changes',()=>{
  assert.throws(()=>taskPatch('task-a',{id:'task-a',detail:'replaced',result:'finished'}),/requirements/);
});
test('invalid dates cannot silently roll into the following month',()=>{
  for(const dueDate of ['2026-02-29','2026-04-31','tomorrow'])assert.throws(()=>taskPatch('a',{id:'a',dueDate}),/date/);
  assert.equal(taskPatch('a',{id:'a',dueDate:'2028-02-29'}).dueDate.toISOString(),'2028-02-28T16:00:00.000Z');
});
test('clear date and owner explicitly without touching original requirements',()=>{
  assert.deepEqual(taskPatch('a',{id:'a',dueDate:'',owner:'  ',status:'doing'}),{dueDate:null,owner:null,status:'doing'});
  assert.throws(()=>taskPatch('a',{id:'a'}),/No task changes/);
});
