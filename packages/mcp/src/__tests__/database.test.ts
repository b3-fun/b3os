import { describe, it, expect } from "vitest";
import { isReadOnlySQL } from "../tools/database.js";

describe("isReadOnlySQL", () => {
  describe("accepts SELECT statements", () => {
    it("plain SELECT", () => {
      expect(isReadOnlySQL("SELECT * FROM users")).toBe(true);
    });

    it("lowercase select", () => {
      expect(isReadOnlySQL("select * from users")).toBe(true);
    });

    it("mixed case", () => {
      expect(isReadOnlySQL("Select * FROM users")).toBe(true);
    });

    it("leading whitespace", () => {
      expect(isReadOnlySQL("   SELECT 1")).toBe(true);
    });

    it("leading newline", () => {
      expect(isReadOnlySQL("\n\tSELECT 1")).toBe(true);
    });

    it("trailing whitespace", () => {
      expect(isReadOnlySQL("SELECT 1   ")).toBe(true);
    });

    it("SELECT with parametrized placeholder", () => {
      expect(isReadOnlySQL("SELECT * FROM events WHERE id = ?")).toBe(true);
    });
  });

  describe("rejects non-SELECT statements", () => {
    // The backend's isReadOnlySQL only accepts the SELECT prefix and routes
    // anything else through database:update — which the MCP service account
    // does not have. So WITH must be rejected at the MCP layer to surface a
    // clear error instead of a 403 from the backend permission gate.
    it("WITH (CTE)", () => {
      expect(isReadOnlySQL("WITH x AS (SELECT 1) SELECT * FROM x")).toBe(false);
    });

    it("CTE-DML attempt", () => {
      expect(isReadOnlySQL("WITH x AS (DELETE FROM users RETURNING *) SELECT * FROM x")).toBe(false);
    });

    it("INSERT", () => {
      expect(isReadOnlySQL("INSERT INTO users (name) VALUES ('a')")).toBe(false);
    });

    it("UPDATE", () => {
      expect(isReadOnlySQL("UPDATE users SET name='b'")).toBe(false);
    });

    it("DELETE", () => {
      expect(isReadOnlySQL("DELETE FROM users")).toBe(false);
    });

    it("DROP TABLE", () => {
      expect(isReadOnlySQL("DROP TABLE users")).toBe(false);
    });

    it("CREATE TABLE", () => {
      expect(isReadOnlySQL("CREATE TABLE x (id INTEGER)")).toBe(false);
    });

    it("ALTER TABLE", () => {
      expect(isReadOnlySQL("ALTER TABLE users ADD COLUMN email TEXT")).toBe(false);
    });

    it("PRAGMA", () => {
      expect(isReadOnlySQL("PRAGMA table_info('users')")).toBe(false);
    });

    it("ATTACH DATABASE", () => {
      expect(isReadOnlySQL("ATTACH DATABASE 'evil.db' AS e")).toBe(false);
    });

    it("EXPLAIN INSERT", () => {
      expect(isReadOnlySQL("EXPLAIN INSERT INTO x VALUES (1)")).toBe(false);
    });

    it("VACUUM", () => {
      expect(isReadOnlySQL("VACUUM")).toBe(false);
    });

    it("empty string", () => {
      expect(isReadOnlySQL("")).toBe(false);
    });

    it("whitespace only", () => {
      expect(isReadOnlySQL("   \n\t")).toBe(false);
    });

    // The backend prefix check requires `SELECT ` with a trailing space, so
    // an identifier starting with SELECT (e.g., a hypothetical SELECTOR
    // keyword) must not slip through here either.
    it("SELECTOR (false-prefix)", () => {
      expect(isReadOnlySQL("SELECTOR foo")).toBe(false);
    });

    it("leading comment then SELECT", () => {
      // Backend does not strip comments — neither do we. Keeps MCP and
      // backend behaviour aligned so users never see a backend 403 for a
      // query the MCP layer accepted.
      expect(isReadOnlySQL("/* note */ SELECT 1")).toBe(false);
    });
  });
});
