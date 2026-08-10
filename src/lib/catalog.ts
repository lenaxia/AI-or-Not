import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import type { CatalogEntry, Label } from "./types";
import { opaqueId } from "./crypto";

const IMAGES_DIR =
  process.env.ROA_IMAGES_DIR?.trim() || path.join(process.cwd(), "images");

const IMAGE_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
};

const LABELS: Label[] = ["ai", "real"];

interface Catalog {
  byId: Map<string, CatalogEntry>;
  byLabel: Record<Label, CatalogEntry[]>;
}

let catalogPromise: Promise<Catalog> | null = null;

async function scan(): Promise<Catalog> {
  const byId = new Map<string, CatalogEntry>();
  const byLabel: Record<Label, CatalogEntry[]> = { ai: [], real: [] };

  for (const label of LABELS) {
    const dir = path.join(IMAGES_DIR, label);
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      byLabel[label] = [];
      continue;
    }
    for (const name of names) {
      const ext = path.extname(name).toLowerCase();
      const mime = IMAGE_EXT[ext];
      if (!mime) continue;
      const absPath = path.join(dir, name);
      const rel = path.relative(process.cwd(), absPath);
      const id = opaqueId(rel);
      const entry: CatalogEntry = { id, absPath, ext, mime, label };
      // Dedupe by id (path collisions are not expected).
      if (!byId.has(id)) {
        byId.set(id, entry);
        byLabel[label].push(entry);
      }
    }
  }

  return { byId, byLabel };
}

export function getCatalog(): Promise<Catalog> {
  if (!catalogPromise) catalogPromise = scan();
  return catalogPromise;
}

export async function getEntry(id: string): Promise<CatalogEntry | undefined> {
  const cat = await getCatalog();
  return cat.byId.get(id);
}

export async function getCounts(): Promise<{ ai: number; real: number }> {
  const cat = await getCatalog();
  return { ai: cat.byLabel.ai.length, real: cat.byLabel.real.length };
}

function pick<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

export async function pickByLabel(
  label: Label,
  excludeId?: string,
): Promise<CatalogEntry | undefined> {
  const cat = await getCatalog();
  const pool = excludeId
    ? cat.byLabel[label].filter((e) => e.id !== excludeId)
    : cat.byLabel[label];
  return pick(pool);
}
