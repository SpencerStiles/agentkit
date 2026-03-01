/**
 * Lightweight Zod-to-JSON-Schema converter.
 *
 * Converts Zod types into the JSON Schema subset that OpenAI function
 * calling expects. Handles the most common Zod types without pulling
 * in the full zod-to-json-schema library.
 */

import type { ZodType } from 'zod';

export function zodToJsonSchema(schema: ZodType): Record<string, unknown> {
  return convertZodType(schema);
}

function convertZodType(schema: ZodType): Record<string, unknown> {
  const def = (schema as any)._def;
  const typeName: string = def?.typeName ?? '';

  switch (typeName) {
    case 'ZodString':
      return handleString(def);
    case 'ZodNumber':
      return handleNumber(def);
    case 'ZodBoolean':
      return { type: 'boolean' };
    case 'ZodArray':
      return {
        type: 'array',
        items: convertZodType(def.type),
      };
    case 'ZodObject':
      return handleObject(def);
    case 'ZodEnum':
      return {
        type: 'string',
        enum: def.values,
      };
    case 'ZodLiteral':
      return {
        type: typeof def.value,
        const: def.value,
      };
    case 'ZodUnion':
      return {
        anyOf: def.options.map((opt: ZodType) => convertZodType(opt)),
      };
    case 'ZodOptional':
      return convertZodType(def.innerType);
    case 'ZodNullable':
      return {
        ...convertZodType(def.innerType),
        nullable: true,
      };
    case 'ZodDefault':
      return {
        ...convertZodType(def.innerType),
        default: def.defaultValue(),
      };
    case 'ZodRecord':
      return {
        type: 'object',
        additionalProperties: convertZodType(def.valueType),
      };
    case 'ZodTuple':
      return {
        type: 'array',
        items: def.items.map((item: ZodType) => convertZodType(item)),
      };
    default:
      return { type: 'string' };
  }
}

function handleString(def: any): Record<string, unknown> {
  const result: Record<string, unknown> = { type: 'string' };
  for (const check of def.checks ?? []) {
    if (check.kind === 'min') result.minLength = check.value;
    if (check.kind === 'max') result.maxLength = check.value;
    if (check.kind === 'regex') result.pattern = check.regex.source;
    if (check.kind === 'email') result.format = 'email';
    if (check.kind === 'url') result.format = 'uri';
  }
  if (def.description) result.description = def.description;
  return result;
}

function handleNumber(def: any): Record<string, unknown> {
  const isInt = def.checks?.some((c: any) => c.kind === 'int');
  const result: Record<string, unknown> = { type: isInt ? 'integer' : 'number' };
  for (const check of def.checks ?? []) {
    if (check.kind === 'min') result.minimum = check.value;
    if (check.kind === 'max') result.maximum = check.value;
  }
  if (def.description) result.description = def.description;
  return result;
}

function handleObject(def: any): Record<string, unknown> {
  const shape = def.shape();
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const fieldDef = (value as any)._def;
    properties[key] = convertZodType(value as ZodType);

    // Field is required unless it's ZodOptional or ZodDefault
    const fieldTypeName = fieldDef?.typeName;
    if (fieldTypeName !== 'ZodOptional' && fieldTypeName !== 'ZodDefault') {
      required.push(key);
    }
  }

  const result: Record<string, unknown> = {
    type: 'object',
    properties,
  };

  if (required.length > 0) {
    result.required = required;
  }

  if (def.description) {
    result.description = def.description;
  }

  return result;
}
