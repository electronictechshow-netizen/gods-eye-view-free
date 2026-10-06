import test from 'node:test';
import assert from 'node:assert/strict';
import { toGeminiSchema, toGeminiTools } from './geminiTools.js';
import { createActionTools } from './actionSchemas.js';

/** Walk every nested schema node so recursive rules can be asserted globally. */
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((entry) => walk(entry, visit));
    return;
  }
  visit(node);
  Object.values(node).forEach((value) => walk(value, visit));
}

test('every real GEV action converts to a Gemini function declaration', () => {
  const tools = createActionTools({});
  const converted = toGeminiTools(tools);

  assert.equal(converted.length, 1, 'one tools entry');
  const declarations = converted[0].functionDeclarations;
  assert.equal(
    declarations.length,
    tools.length,
    'no action is dropped in translation',
  );
  assert.deepEqual(
    declarations.map((entry) => entry.name).sort(),
    tools.map((entry) => entry.name).sort(),
    'names survive verbatim',
  );
});

test('additionalProperties is stripped at every depth', () => {
  // The real registry sets additionalProperties on nearly every action, and
  // Gemini rejects the whole setup if one survives.
  const tools = createActionTools({});
  const sourceHasIt = JSON.stringify(tools).includes('additionalProperties');
  assert.ok(sourceHasIt, 'fixture is meaningful: source really contains it');

  const converted = toGeminiTools(tools);
  assert.ok(
    !JSON.stringify(converted).includes('additionalProperties'),
    'no additionalProperties reaches Gemini',
  );
});

test('every emitted type is a Gemini uppercase type name', () => {
  const allowed = new Set([
    'STRING',
    'NUMBER',
    'INTEGER',
    'BOOLEAN',
    'ARRAY',
    'OBJECT',
  ]);
  walk(toGeminiTools(createActionTools({})), (node) => {
    if (typeof node.type === 'string')
      assert.ok(allowed.has(node.type), `unexpected type ${node.type}`);
  });
});

test('enums, ranges and nested properties are preserved', () => {
  const [{ functionDeclarations }] = toGeminiTools(createActionTools({}));
  const flyTo = functionDeclarations.find(
    (entry) => entry.name === 'fly_to_location',
  );
  assert.ok(flyTo, 'fly_to_location present');
  assert.equal(flyTo.parameters.type, 'OBJECT');

  const props = flyTo.parameters.properties;
  assert.ok(props.locationId.enum.includes('tokyo'), 'string enum kept');
  assert.equal(props.latitude.type, 'NUMBER');
  assert.equal(props.latitude.minimum, -90, 'numeric bounds kept');
  assert.equal(props.latitude.maximum, 90);
  assert.equal(props.waitForArrival.type, 'BOOLEAN');
});

test('nullable unions collapse to a type plus nullable flag', () => {
  const converted = toGeminiSchema({ type: ['string', 'null'] });
  assert.deepEqual(converted, { type: 'STRING', nullable: true });
});

test('object schemas always carry a properties map', () => {
  // Some Gemini model versions reject a bare OBJECT with no properties.
  assert.deepEqual(toGeminiSchema({ type: 'object' }), {
    type: 'OBJECT',
    properties: {},
  });
});

test('array item schemas are converted recursively', () => {
  const converted = toGeminiSchema({
    type: 'array',
    items: {
      type: 'object',
      additionalProperties: false,
      properties: { a: { type: 'string' } },
    },
  });
  assert.equal(converted.type, 'ARRAY');
  assert.equal(converted.items.type, 'OBJECT');
  assert.equal(converted.items.properties.a.type, 'STRING');
  assert.ok(!('additionalProperties' in converted.items));
});

test('non-string enums are dropped rather than sent as-is', () => {
  const converted = toGeminiSchema({ type: 'number', enum: [1, 2, 3] });
  assert.equal(converted.type, 'NUMBER');
  assert.ok(!('enum' in converted), 'Gemini only accepts string enums');
});

test('the nested {type:function, function:{}} spelling is accepted', () => {
  const converted = toGeminiTools([
    { type: 'function', function: { name: 'nested', description: 'd' } },
  ]);
  assert.equal(converted[0].functionDeclarations[0].name, 'nested');
  assert.equal(converted[0].functionDeclarations[0].description, 'd');
});

test('malformed tool entries are skipped, not thrown on', () => {
  assert.deepEqual(toGeminiTools(null), []);
  assert.deepEqual(toGeminiTools([null, {}, { name: '  ' }, 7]), []);
  const converted = toGeminiTools([{ name: 'ok' }, null]);
  assert.equal(converted[0].functionDeclarations.length, 1);
});

test('a parameterless tool omits parameters entirely', () => {
  const [{ functionDeclarations }] = toGeminiTools([{ name: 'ping' }]);
  assert.ok(!('parameters' in functionDeclarations[0]));
});
