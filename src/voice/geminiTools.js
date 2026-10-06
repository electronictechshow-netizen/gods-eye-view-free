/**
 * Translate GEV's function-tool definitions into Gemini Live
 * `functionDeclarations`.
 *
 * The two formats are both OpenAPI-flavoured but not identical: Gemini's Schema
 * accepts a fixed field set and rejects a declaration outright when it carries
 * an unknown key. `additionalProperties` is the one GEV emits on every action,
 * so a naive passthrough fails the whole session at setup rather than degrading
 * one tool.
 */

/** Schema keys Gemini's Live API accepts. Anything else is dropped. */
const SUPPORTED_SCHEMA_KEYS = new Set([
  'type',
  'format',
  'title',
  'description',
  'nullable',
  'enum',
  'items',
  'properties',
  'required',
  'minItems',
  'maxItems',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'pattern',
  'default',
  'anyOf',
  'propertyOrdering',
]);

/** JSON Schema type names Gemini understands, lowercase in, uppercase out. */
const TYPE_NAMES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
]);

/**
 * Stand-in for an untyped JSON Schema node (`{}` means "any value").
 *
 * Gemini's Schema has no "any" — every node needs a type — but dropping the
 * property is worse than approximating it: a name left in `required` with no
 * matching property makes Google reject the whole setup, not just that tool.
 */
const ANY_SCALAR = Object.freeze({
  anyOf: [{ type: 'STRING' }, { type: 'NUMBER' }, { type: 'BOOLEAN' }],
});

function normalizeType(value) {
  // A nullable union (`['string','null']`) becomes the non-null member plus an
  // explicit nullable flag, which is how Gemini spells the same thing.
  if (Array.isArray(value)) {
    const members = value.filter((entry) => entry !== 'null');
    const nullable = members.length !== value.length;
    const first = members.find((entry) => TYPE_NAMES.has(entry));
    return { type: first ? first.toUpperCase() : undefined, nullable };
  }
  if (typeof value === 'string' && TYPE_NAMES.has(value))
    return { type: value.toUpperCase(), nullable: false };
  return { type: undefined, nullable: false };
}

/**
 * Recursively copy a JSON Schema into Gemini's accepted subset.
 *
 * @param {unknown} schema - A JSON Schema node from the GEV action registry.
 * @returns {object|null} A Gemini-safe schema node, or null when unusable.
 */
export function toGeminiSchema(schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema))
    return null;

  const output = {};
  let nullable = false;
  let required = null;

  for (const [key, value] of Object.entries(schema)) {
    if (key === 'type') {
      const resolved = normalizeType(value);
      if (resolved.type) output.type = resolved.type;
      nullable = nullable || resolved.nullable;
      continue;
    }
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) continue;

    if (key === 'properties') {
      if (!value || typeof value !== 'object') continue;
      const properties = {};
      for (const [name, child] of Object.entries(value)) {
        const converted = toGeminiSchema(child);
        if (converted) properties[name] = converted;
      }
      if (Object.keys(properties).length) output.properties = properties;
      continue;
    }
    if (key === 'items') {
      const converted = toGeminiSchema(value);
      if (converted) output.items = converted;
      continue;
    }
    if (key === 'anyOf') {
      if (!Array.isArray(value)) continue;
      const variants = value
        .map((entry) => toGeminiSchema(entry))
        .filter(Boolean);
      if (variants.length) output.anyOf = variants;
      continue;
    }
    if (key === 'enum') {
      // Gemini only accepts string enums; a mixed list is passed through as a
      // plain typed field rather than a constraint it would reject.
      if (!Array.isArray(value) || !value.length) continue;
      if (!value.every((entry) => typeof entry === 'string')) continue;
      output.enum = [...value];
      continue;
    }
    if (key === 'required') {
      // Resolved after the loop: `properties` may not have been seen yet, and
      // a required name with no matching property is a hard rejection.
      if (Array.isArray(value) && value.length) required = value;
      continue;
    }
    output[key] = value;
  }

  if (nullable) output.nullable = true;
  // An object with no declared properties is meaningless to Gemini and makes
  // some model versions reject the declaration, so state the empty shape.
  if (output.type === 'OBJECT' && !output.properties) output.properties = {};

  if (required) {
    // Keep only names that survived conversion. Google validates this and
    // fails the ENTIRE setup — every tool, not just this one — on a mismatch.
    const declared = output.properties || {};
    const kept = required.filter((name) => Object.hasOwn(declared, name));
    if (kept.length) output.required = kept;
  }

  // `{}` (any value) and nodes whose every key was unsupported yield nothing.
  // Approximate rather than drop, so the parent's `required` stays satisfiable.
  return Object.keys(output).length ? output : { ...ANY_SCALAR };
}

/**
 * Convert GEV's function-tool array into a Gemini `tools` payload.
 *
 * @param {Array<object>} tools - Entries shaped `{type:'function',name,...}`.
 * @returns {Array<{functionDeclarations: Array<object>}>} Gemini tools, or [].
 */
export function toGeminiTools(tools = []) {
  if (!Array.isArray(tools)) return [];
  const functionDeclarations = [];

  for (const tool of tools) {
    if (!tool || typeof tool !== 'object') continue;
    // GEV emits a flat {type:'function', name, ...}; the nested
    // {type:'function', function:{...}} spelling is also accepted so this keeps
    // working if the registry ever moves to it.
    const source =
      tool.function && typeof tool.function === 'object' ? tool.function : tool;
    const name = typeof source.name === 'string' ? source.name.trim() : '';
    if (!name) continue;

    const declaration = { name };
    if (typeof source.description === 'string' && source.description.trim())
      declaration.description = source.description.trim();

    const parameters = toGeminiSchema(source.parameters);
    // Gemini requires OBJECT-typed parameters; a parameterless tool omits the
    // field entirely rather than sending an empty schema.
    if (parameters && parameters.type === 'OBJECT')
      declaration.parameters = parameters;

    functionDeclarations.push(declaration);
  }

  return functionDeclarations.length ? [{ functionDeclarations }] : [];
}
