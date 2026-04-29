import type { SchemaDefinition } from "../../src/types";

export const payloadSchema: SchemaDefinition = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description: 'Name to greet. Defaults to "World".',
      default: "World",
    },
  },
  additionalProperties: false,
};

export const resultSchema: SchemaDefinition = {
  type: "object",
  required: ["message"],
  properties: {
    message: {
      type: "string",
      description: "The greeting message",
    },
    timestamp: {
      type: "string",
      description: "ISO timestamp of when the greeting was generated",
    },
  },
  additionalProperties: false,
};
