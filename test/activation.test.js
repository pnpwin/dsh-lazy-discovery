import test from 'node:test';
import assert from 'node:assert/strict';
import { foldActivation, initialActivation } from '../src/lib/activation.js';
const record = { id: 'mcp__fixture__echo', hash: 'a'.repeat(64) };
const call = { type: 'tool/call', data: { name: 'mcp_tools_load', callId: 'call-1' } };
const result = value => ({ type: 'tool/result', data: { message: { toolCallId: 'call-1', content: [{ type: 'text', text: JSON.stringify(value) }] } } });
test('committed paired load result is the sole selection authority', () => {
 const initial = initialActivation(); const completed = result({ version: 1, activated: [record] });
 assert.equal(foldActivation(initial, completed), initial);
 const afterCall = foldActivation(initial, call); assert.deepEqual(afterCall.selected, {});
 const loaded = foldActivation(afterCall, completed); assert.deepEqual(loaded.selected, { [record.id]: record.hash }); assert.deepEqual(loaded.pending, {});
 // Fork/resume reconstructs the exact same intent by folding the inherited log.
 assert.deepEqual([call, completed].reduce(foldActivation, initialActivation()), loaded);
});
test('failed, unrelated and malformed results cannot load tools', () => {
 const pending = foldActivation(initialActivation(), call);
 const failed = result({ version: 1, activated: [record] }); failed.data.message.isError = true;
 assert.deepEqual(foldActivation(pending, failed).selected, {});
 assert.deepEqual(foldActivation(pending, result({ version: 1, activated: [{ id: '__proto__', hash: 'bad' }] })).selected, {});
 assert.deepEqual(foldActivation(initialActivation(), { type: 'user/message', data: { activated: [record] } }).selected, {});
 assert.deepEqual(foldActivation(pending, result(null)).selected, {});
 assert.deepEqual(foldActivation(pending, result({ version: 1, activated: [null] })).selected, {});
 const inherited = result({ version: 1, activated: [record] }); inherited.data.message.toolCallId = 'constructor';
 assert.deepEqual(foldActivation(initialActivation(), inherited).selected, {});
});
