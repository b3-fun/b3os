import type { SchemaDefinition } from "../../src/types";

export const payloadSchema: SchemaDefinition = {
  type: "object",
  properties: {
    format: {
      type: "string",
      enum: ["uuid", "shortid"],
      enumNames: ["UUID (v4)", "Short ID (alphanumeric)"],
      description:
        "ID format to generate. UUID is 36 chars, Short ID is customizable length.",
      default: "uuid",
    },
    length: {
      type: "number",
      description: "Length for short ID (default: 8). Ignored for UUID format.",
      minimum: 4,
      maximum: 32,
      default: 8,
    },
  },
  additionalProperties: false,
};

export const resultSchema: SchemaDefinition = {
  type: "object",
  required: ["id", "format"],
  properties: {
    id: {
      type: "string",
      description: "The generated unique identifier",
    },
    format: {
      type: "string",
      description: "The format used to generate the ID",
    },
  },
  additionalProperties: false,
};
