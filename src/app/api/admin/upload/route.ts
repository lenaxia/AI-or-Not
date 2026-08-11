import { requireAdmin } from "@/lib/admin-auth";
import { uploadImage, MAX_UPLOAD_BYTES } from "@/lib/catalog";

const MAX_FILES = 20;

export async function POST(request: Request) {
  const guard = requireAdmin(request);
  if (guard) return guard;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "invalid-form-data" }, { status: 400 });
  }

  const labelRaw = form.get("label");
  if (labelRaw !== "ai" && labelRaw !== "real") {
    return Response.json({ error: "invalid-label" }, { status: 400 });
  }
  const label = labelRaw;

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return Response.json({ error: "no-files" }, { status: 400 });
  }
  if (files.length > MAX_FILES) {
    return Response.json(
      { error: "too-many-files", max: MAX_FILES },
      { status: 400 },
    );
  }

  const results: Array<{
    name: string;
    ok: boolean;
    id?: string;
    sha1?: string;
    duplicate?: boolean;
    error?: string;
  }> = [];
  let inserted = 0;
  let duplicates = 0;
  let errors = 0;

  for (const file of files) {
    if (file.size > MAX_UPLOAD_BYTES) {
      results.push({ name: file.name, ok: false, error: "too-large" });
      errors++;
      continue;
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    const res = await uploadImage(label, file.name, bytes);
    if (res.ok) {
      results.push({
        name: file.name,
        ok: true,
        id: res.id,
        sha1: res.sha1,
        duplicate: res.duplicate,
      });
      if (res.duplicate) duplicates++;
      else inserted++;
    } else {
      results.push({ name: file.name, ok: false, error: res.error });
      errors++;
    }
  }

  return Response.json({ inserted, duplicates, errors, results });
}
