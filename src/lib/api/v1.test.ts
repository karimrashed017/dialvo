import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor, pageOf, pageSize } from "./v1";

describe("pages", () => {
  it("round-trip a cursor and refuse a forged one", () => {
    const row = {
      created_at: "2026-11-21T10:00:00.000Z",
      id: "0b1c2d3e-0000-4000-8000-000000000001",
    };
    expect(decodeCursor(encodeCursor(row))).toEqual({
      c: row.created_at,
      i: row.id,
    });
    expect(decodeCursor(null)).toBe(null);
    expect(decodeCursor("not-ours")).toBe("bad");
    // A cursor can't smuggle a filter into the query.
    const evil = Buffer.from(
      JSON.stringify({ c: "2026-01-01),workspace_id.neq.x", i: row.id }),
    ).toString("base64url");
    expect(decodeCursor(evil)).toBe("bad");
  });

  it("size and split a page", () => {
    expect(pageSize(null)).toBe(25);
    expect(pageSize("100")).toBe(100);
    expect(pageSize("101")).toBe(null);
    expect(pageSize("0")).toBe(null);
    const rows = [1, 2, 3].map((n) => ({
      created_at: `2026-11-2${n}T00:00:00.000Z`,
      id: `0b1c2d3e-0000-4000-8000-00000000000${n}`,
    }));
    const p = pageOf(rows, 2);
    expect(p.data).toHaveLength(2);
    expect(decodeCursor(p.next_cursor)).toEqual({
      c: rows[1].created_at,
      i: rows[1].id,
    });
    expect(pageOf(rows, 3).next_cursor).toBe(null);
  });
});
