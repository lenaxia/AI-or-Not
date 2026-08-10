import fs from "node:fs/promises";
import { getEntry } from "@/lib/catalog";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const entry = await getEntry(id);
  if (!entry) {
    return new Response("Not found", { status: 404 });
  }

  let data: Buffer;
  try {
    data = await fs.readFile(entry.absPath);
  } catch {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(data), {
    status: 200,
    headers: {
      "Content-Type": entry.mime,
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
    },
  });
}
