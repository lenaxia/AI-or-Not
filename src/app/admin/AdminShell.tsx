"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Upload,
  Image as ImageIcon,
  Trophy,
  LogOut,
  RefreshCw,
  Loader2,
  Trash2,
  Eye,
  EyeOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Label = "ai" | "real";

interface ImageRow {
  id: string;
  sha1: string;
  label: Label;
  source: string;
  ext: string;
  elo: number;
  appearances: number;
  fools: number;
  retired: boolean;
}

interface ImagesResponse {
  rows: ImageRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface EloResponse {
  ai: ImageRow[];
  real: ImageRow[];
}

interface UploadResult {
  inserted: number;
  duplicates: number;
  errors: number;
  results: Array<{
    name: string;
    ok: boolean;
    error?: string;
    duplicate?: boolean;
  }>;
}

type Tab = "gallery" | "elo";

export default function AdminShell() {
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>("gallery");
  const [checking, setChecking] = useState(true);

  // Check whether we already have a valid session by hitting a protected
  // endpoint. 401 → show login; 200 → skip login.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin/images?page=1");
        setAuthed(res.ok);
      } catch {
        setAuthed(false);
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  if (checking) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!authed) {
    return <LoginView onOk={() => setAuthed(true)} />;
  }

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold">Admin</h1>
        <div className="flex gap-2">
          <Button
            variant={tab === "gallery" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("gallery")}
            className="gap-1.5"
          >
            <ImageIcon className="size-4" /> Gallery
          </Button>
          <Button
            variant={tab === "elo" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("elo")}
            className="gap-1.5"
          >
            <Trophy className="size-4" /> ELO
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await fetch("/api/admin/logout", { method: "POST" });
              setAuthed(false);
            }}
            className="gap-1.5"
          >
            <LogOut className="size-4" /> Log out
          </Button>
        </div>
      </div>
      {tab === "gallery" ? <GalleryView /> : <EloView />}
    </div>
  );
}

// ---------- LOGIN ----------

function LoginView({ onOk }: { onOk: () => void }) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        onOk();
        return;
      }
      setErr(res.status === 401 ? "Wrong password." : "Login failed.");
    } catch {
      setErr("Network error.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-sm mx-auto px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Admin login</CardTitle>
          <CardDescription>Enter the admin password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-4">
            <input
              type="password"
              autoFocus
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="Password"
              disabled={busy}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {err && (
              <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
                {err}
              </p>
            )}
            <Button type="submit" disabled={busy || !pw} className="h-11">
              {busy ? "Logging in…" : "Log in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// ---------- GALLERY ----------

function GalleryView() {
  const [data, setData] = useState<ImagesResponse | null>(null);
  const [labelFilter, setLabelFilter] = useState<Label | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<"active" | "retired" | undefined>(undefined);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadLabel, setUploadLabel] = useState<Label>("ai");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page) });
    if (labelFilter) params.set("label", labelFilter);
    if (statusFilter) params.set("status", statusFilter);
    try {
      const res = await fetch(`/api/admin/images?${params}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [page, labelFilter, statusFilter]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const doUpload = async (files: FileList) => {
    setUploadMsg(null);
    const form = new FormData();
    form.set("label", uploadLabel);
    for (const f of Array.from(files)) form.append("files", f);
    try {
      const res = await fetch("/api/admin/upload", {
        method: "POST",
        body: form,
      });
      const r: UploadResult = await res.json();
      setUploadMsg(
        `Inserted ${r.inserted}, duplicates ${r.duplicates}, errors ${r.errors}`,
      );
      void load();
    } catch {
      setUploadMsg("Upload failed.");
    }
  };

  const act = async (id: string, action: "retire" | "reactivate" | "delete") => {
    await fetch("/api/admin/images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    void load();
  };

  const reindex = async () => {
    setUploadMsg("Reindexing…");
    const res = await fetch("/api/admin/reindex", { method: "POST" });
    const r = await res.json();
    setUploadMsg(
      `Reindexed: +${r.added} added, ${r.duplicates} duplicates, -${r.removed ?? 0} removed, ${r.skipped ?? 0} skipped`,
    );
    void load();
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Upload + reindex */}
      <Card>
        <CardContent className="pt-6 flex flex-wrap gap-3 items-center">
          <select
            value={uploadLabel}
            onChange={(e) => setUploadLabel(e.target.value as Label)}
            className="h-9 rounded-md border bg-background px-2 text-sm"
          >
            <option value="ai">AI</option>
            <option value="real">Real</option>
          </select>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                void doUpload(e.target.files);
                e.target.value = "";
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="size-4" /> Upload
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={reindex}>
            <RefreshCw className="size-4" /> Reindex
          </Button>
          {uploadMsg && <span className="text-sm text-muted-foreground">{uploadMsg}</span>}
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <FilterPill active={!labelFilter} onClick={() => { setLabelFilter(undefined); setPage(1); }}>
          All labels
        </FilterPill>
        <FilterPill active={labelFilter === "ai"} onClick={() => { setLabelFilter("ai"); setPage(1); }}>
          AI
        </FilterPill>
        <FilterPill active={labelFilter === "real"} onClick={() => { setLabelFilter("real"); setPage(1); }}>
          Real
        </FilterPill>
        <span className="mx-2 text-border">·</span>
        <FilterPill active={!statusFilter} onClick={() => { setStatusFilter(undefined); setPage(1); }}>
          All
        </FilterPill>
        <FilterPill active={statusFilter === "active"} onClick={() => { setStatusFilter("active"); setPage(1); }}>
          Active
        </FilterPill>
        <FilterPill active={statusFilter === "retired"} onClick={() => { setStatusFilter("retired"); setPage(1); }}>
          Retired
        </FilterPill>
        <span className="ml-auto text-sm text-muted-foreground">
          {data ? `${data.total} image${data.total === 1 ? "" : "s"}` : ""}
        </span>
      </div>

      {/* Grid */}
      {loading && !data ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : data && data.rows.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {data.rows.map((r) => (
            <ImageTile key={r.id} row={r} onAct={act} />
          ))}
        </div>
      ) : (
        <p className="text-center text-sm text-muted-foreground py-12">
          No images match.
        </p>
      )}

      {/* Pagination */}
      {data && data.total > data.pageSize && (
        <div className="flex justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Prev
          </Button>
          <span className="text-sm self-center text-muted-foreground">
            {page} / {Math.max(1, Math.ceil(data.total / data.pageSize))}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page * data.pageSize >= data.total}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

function ImageTile({
  row,
  onAct,
}: {
  row: ImageRow;
  onAct: (id: string, action: "retire" | "reactivate" | "delete") => void;
}) {
  const foolRate =
    row.appearances > 0 ? Math.round((row.fools / row.appearances) * 100) : null;
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="relative aspect-square bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- admin-only, opaque id */}
        <img
          src={`/api/img/${row.id}`}
          alt={row.id}
          className="absolute inset-0 size-full object-cover"
          draggable={false}
        />
        <div className="absolute top-2 left-2 flex gap-1">
          <Badge variant={row.label === "ai" ? "default" : "secondary"}>
            {row.label === "ai" ? "AI" : "Real"}
          </Badge>
          {row.retired && <Badge variant="destructive">retired</Badge>}
        </div>
      </div>
      <div className="p-2 text-xs space-y-1">
        <div className="flex justify-between">
          <span className="font-mono text-muted-foreground">
            {row.sha1.slice(0, 8)}
          </span>
          <span className="tabular-nums">ELO {Math.round(row.elo)}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>{row.appearances} views</span>
          {foolRate !== null && <span>{foolRate}% fool</span>}
        </div>
        <div className="flex gap-1 pt-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs flex-1 gap-1"
            onClick={() => onAct(row.id, row.retired ? "reactivate" : "retire")}
          >
            {row.retired ? (
              <>
                <Eye className="size-3" /> Activate
              </>
            ) : (
              <>
                <EyeOff className="size-3" /> Retire
              </>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
            onClick={() => {
              if (confirm("Hard-delete this image row? The source file is not touched.")) {
                onAct(row.id, "delete");
              }
            }}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------- ELO ----------

function EloView() {
  const [data, setData] = useState<EloResponse | null>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/admin/elo");
      if (res.ok) setData(await res.json());
    })();
  }, []);

  if (!data) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      <EloColumn title="AI" rows={data.ai} />
      <EloColumn title="Real" rows={data.real} />
    </div>
  );
}

function EloColumn({ title, rows }: { title: string; rows: ImageRow[] }) {
  return (
    <div>
      <h2 className="text-sm font-medium mb-2">{title} ({rows.length})</h2>
      <div className="flex flex-col gap-1.5">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4 text-center">
            No images.
          </p>
        ) : (
          rows.map((r, i) => (
            <div
              key={r.id}
              className="flex items-center gap-2 rounded-md border p-1.5"
            >
              <span className="text-xs text-muted-foreground w-6 tabular-nums">
                {i + 1}
              </span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/img/${r.id}`}
                alt={r.id}
                className="size-10 rounded object-cover bg-muted"
                draggable={false}
              />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono text-muted-foreground truncate">
                  {r.sha1.slice(0, 12)}
                </div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {r.appearances} views
                  {r.appearances > 0 &&
                    ` · ${Math.round((r.fools / r.appearances) * 100)}% fool`}
                </div>
              </div>
              <span className="text-sm font-semibold tabular-nums">
                {Math.round(r.elo)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
