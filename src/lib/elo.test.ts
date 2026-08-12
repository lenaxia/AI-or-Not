import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "@/db/schema";

// Use shared-cache in-memory so multiple connections (drizzle's batch/txn
// path) see the same DB. Plain `:memory:` is per-connection in libsql and
// silently breaks anything that opens a second connection.
const url = "file::memory:?cache=shared";
const mem = createClient({ url });
const memDb = drizzle(mem, { schema });

vi.mock("@/db", () => ({ db: memDb }));

type Side = import("./elo").Side;
type Guess = import("./elo").Guess;
type ImageLabel = import("./elo").ImageLabel;

const {
  expectedScore,
  eloDelta,
  imageFooledPlayer,
  recordAppearance,
  _ELO_CONSTANTS,
} = await import("./elo");

const { K_FACTOR } = _ELO_CONSTANTS;

const IMAGE_TABLE_SQL = `CREATE TABLE images (
  id TEXT PRIMARY KEY NOT NULL,
  sha1 TEXT NOT NULL,
  label TEXT NOT NULL,
  source TEXT NOT NULL,
  locator TEXT NOT NULL,
  ext TEXT NOT NULL,
  mime TEXT NOT NULL,
  elo INTEGER DEFAULT 1000 NOT NULL,
  appearances INTEGER DEFAULT 0 NOT NULL,
  fools INTEGER DEFAULT 0 NOT NULL,
  retired INTEGER DEFAULT false NOT NULL,
  indexed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`;

beforeEach(async () => {
  await mem.batch([
    "DROP TABLE IF EXISTS images",
    IMAGE_TABLE_SQL,
    "CREATE UNIQUE INDEX images_sha1_unique ON images (sha1)",
    "DROP TABLE IF EXISTS rejected_images",
    `CREATE TABLE rejected_images (sha1 TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL, source_key TEXT, rejected_at INTEGER NOT NULL)`,
  ]);
});

afterEach(async () => {
  await mem.execute("DELETE FROM images");
});

describe("expectedScore", () => {
  it("is 0.5 at the population baseline (1000)", () => {
    expect(expectedScore(1000)).toBeCloseTo(0.5, 6);
  });

  it("approaches 1 for very high image ELO", () => {
    expect(expectedScore(2000)).toBeGreaterThan(0.97);
  });

  it("approaches 0 for very low image ELO", () => {
    expect(expectedScore(0)).toBeLessThan(0.03);
  });

  it("is symmetric: expectedScore(1000+x) + expectedScore(1000-x) ≈ 1", () => {
    const hi = expectedScore(1400);
    const lo = expectedScore(600);
    expect(hi + lo).toBeCloseTo(1, 6);
  });
});

describe("eloDelta", () => {
  it("is +K/2 for a baseline image that fools the player", () => {
    expect(eloDelta(1000, true)).toBeCloseTo(K_FACTOR / 2, 6);
  });

  it("is -K/2 for a baseline image that the player catches", () => {
    expect(eloDelta(1000, false)).toBeCloseTo(-K_FACTOR / 2, 6);
  });

  it("is small positive when a high-elo image fools the player", () => {
    expect(eloDelta(1600, true)).toBeLessThan(eloDelta(1000, true));
    expect(eloDelta(1600, true)).toBeGreaterThan(0);
  });

  it("is large positive when a low-elo image fools the player", () => {
    expect(eloDelta(400, true)).toBeGreaterThan(eloDelta(1000, true));
  });

  it("is large negative when a high-elo image gets caught", () => {
    expect(eloDelta(1600, false)).toBeLessThan(0);
    expect(eloDelta(1600, false)).toBeLessThan(eloDelta(1000, false));
  });
});

describe("imageFooledPlayer — full outcome matrix", () => {
  const cases: Array<{
    label: ImageLabel;
    side: Side;
    guess: Guess;
    fooled: boolean;
  }> = [
    // AI images — fooled iff player did NOT flag this side as AI
    { label: "ai", side: "left", guess: "left", fooled: false },
    { label: "ai", side: "left", guess: "both", fooled: false },
    { label: "ai", side: "left", guess: "right", fooled: true },
    { label: "ai", side: "left", guess: "none", fooled: true },
    { label: "ai", side: "right", guess: "right", fooled: false },
    { label: "ai", side: "right", guess: "both", fooled: false },
    { label: "ai", side: "right", guess: "left", fooled: true },
    { label: "ai", side: "right", guess: "none", fooled: true },
    // Real images — fooled iff player DID flag this side as AI
    { label: "real", side: "left", guess: "left", fooled: true },
    { label: "real", side: "left", guess: "both", fooled: true },
    { label: "real", side: "left", guess: "right", fooled: false },
    { label: "real", side: "left", guess: "none", fooled: false },
    { label: "real", side: "right", guess: "right", fooled: true },
    { label: "real", side: "right", guess: "both", fooled: true },
    { label: "real", side: "right", guess: "left", fooled: false },
    { label: "real", side: "right", guess: "none", fooled: false },
  ];

  for (const c of cases) {
    const verb = c.fooled ? "fools" : "does not fool";
    it(`${c.label} on ${c.side}, guess=${c.guess} → image ${verb} the player`, () => {
      expect(imageFooledPlayer(c.label, c.side, c.guess)).toBe(c.fooled);
    });
  }
});

describe("recordAppearance (atomic DB update)", () => {
  async function insert(id: string, elo = 1000) {
    await mem.execute({
      sql: `INSERT INTO images (id, sha1, label, source, locator, ext, mime,
            elo, appearances, fools, retired, indexed_at, updated_at)
            VALUES (?, 'sha-' || ?, 'ai', 'fs', '/x', '.jpg', 'image/jpeg',
                    ?, 0, 0, 0, 0, 0)`,
      args: [id, id, elo],
    });
  }

  async function getRow(id: string) {
    const r = await mem.execute({
      sql: "SELECT elo, appearances, fools FROM images WHERE id = ?",
      args: [id],
    });
    return r.rows[0];
  }

  it("increments appearances + fools on a fool, and moves ELO up", async () => {
    await insert("a");
    await recordAppearance("a", true);
    const row = await getRow("a");
    expect(row!.appearances).toBe(1);
    expect(row!.fools).toBe(1);
    expect(row!.elo).toBeGreaterThan(1000);
  });

  it("increments appearances only on a catch, and moves ELO down", async () => {
    await insert("a");
    await recordAppearance("a", false);
    const row = await getRow("a");
    expect(row!.appearances).toBe(1);
    expect(row!.fools).toBe(0);
    expect(row!.elo).toBeLessThan(1000);
  });

  it("respects the ELO floor (100)", async () => {
    await insert("a", 110);
    for (let i = 0; i < 100; i++) await recordAppearance("a", false);
    const row = await getRow("a");
    expect(row!.elo).toBeGreaterThanOrEqual(100);
    expect(row!.elo).toBeLessThanOrEqual(110);
  });

  it("matches the pure eloDelta calculation", async () => {
    await insert("a", 1234);
    const before = Number((await getRow("a"))!.elo);
    await recordAppearance("a", true);
    const after = Number((await getRow("a"))!.elo);
    // SQL uses REAL; allow tiny float slack.
    expect(after).toBeCloseTo(before + eloDelta(before, true), 3);
  });

  it("does not lose updates: 50 concurrent appearances all land", async () => {
    // The whole point of the single-statement atomic update (stress note #2):
    // concurrent guesses on a popular image must each apply exactly once.
    await insert("a");
    const updates = [];
    for (let i = 0; i < 50; i++) updates.push(recordAppearance("a", true));
    await Promise.all(updates);
    const row = await getRow("a");
    expect(row!.appearances).toBe(50);
    expect(row!.fools).toBe(50);
  });

  it("is a no-op when the image doesn't exist (UPDATE matches 0 rows)", async () => {
    await expect(recordAppearance("nope", true)).resolves.toBeUndefined();
  });
});
