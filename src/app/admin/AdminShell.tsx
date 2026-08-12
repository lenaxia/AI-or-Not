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
  Check,
  X,
  Forward,
  ClipboardCheck,
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

type Tab = "gallery" | "elo" | "pending";

interface PendingItem {
  key: string;
  label: Label;
  ext: string;
  mime: string;
}

interface PendingResponse {
  items: PendingItem[];
  total: number;
  page: number;
  pageSize: number;
}

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
            variant={tab === "pending" ? "default" : "outline"}
            size="sm"
            onClick={() => setTab("pending")}
            className="gap-1.5"
          >
            <ClipboardCheck className="size-4" /> Pending
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
      {tab === "gallery" ? (
        <GalleryView />
      ) : tab === "pending" ? (
        <PendingView />
      ) : (
        <EloView />
      )}
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
  const [pageSize, setPageSize] = useState(100);
  const [loading, setLoading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [uploadLabel, setUploadLabel] = useState<Label>("ai");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (labelFilter) params.set("label", labelFilter);
    if (statusFilter) params.set("status", statusFilter);
    try {
      const res = await fetch(`/api/admin/images?${params}`);
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, labelFilter, statusFilter]);

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

  const act = async (id: string, action: "retire" | "reactivate" | "delete" | "delete-source") => {
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
        <span className="ml-auto flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {data ? `${data.total} image${data.total === 1 ? "" : "s"}` : ""}
          </span>
          <select
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
            className="h-8 rounded-md border bg-background px-2 text-sm"
            title="Images per page"
          >
            <option value={24}>24 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
            <option value={200}>200 / page</option>
          </select>
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
  onAct: (id: string, action: "retire" | "reactivate" | "delete" | "delete-source") => void;
}) {
  const foolRate =
    row.appearances > 0 ? Math.round((row.fools / row.appearances) * 100) : null;
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="relative bg-muted flex items-center justify-center" style={{ minHeight: "100px" }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- admin-only, opaque id */}
        <img
          src={`/api/img/${row.id}`}
          alt={row.id}
          className="w-full max-h-48 object-contain"
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
              const choice = confirm(
                "Delete options:\n\n" +
                "OK = Delete row + source file/object (permanent)\n" +
                "Cancel = Keep the source, just remove from the catalog\n\n" +
                "(Click the X below to dismiss without deleting)",
              );
              if (choice) {
                onAct(row.id, "delete-source");
              } else {
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

// ---------- PENDING REVIEW ----------

function PendingView() {
  const [data, setData] = useState<PendingResponse | null>(null);
  const [labelFilter, setLabelFilter] = useState<Label | undefined>(undefined);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [reviewed, setReviewed] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: "1" });
    if (labelFilter) params.set("label", labelFilter);
    try {
      const res = await fetch(`/api/admin/pending?${params}`);
      if (res.ok) {
        const d: PendingResponse = await res.json();
        setData(d);
        setIdx(0);
      }
    } finally {
      setLoading(false);
    }
  }, [labelFilter]);

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

  const current = data?.items[idx];

  const review = useCallback(
    async (action: "accept" | "reject") => {
      if (!current || busy) return;
      setBusy(true);
      setMsg(null);
      try {
        const res = await fetch("/api/admin/pending/review", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            key: current.key,
            label: current.label,
            action,
          }),
        });
        const r = await res.json();
        if (!res.ok) {
          setMsg(r.error ?? "Review failed.");
          return;
        }
        setReviewed((n) => n + 1);
        if (action === "accept" && r.duplicate) {
          setMsg("Accepted (duplicate — already in rotation).");
        } else if (action === "accept") {
          setMsg(`Accepted → ${r.promotedTo}`);
        } else {
          setMsg("Rejected. Hash recorded.");
        }
        // Advance; trim the current item from the list.
        setData((prev) => {
          if (!prev) return prev;
          const items = prev.items.filter((_, i) => i !== idx);
          return { ...prev, items, total: items.length };
        });
        setIdx((i) => Math.min(i, Math.max(0, (data?.items.length ?? 1) - 2)));
      } finally {
        setBusy(false);
      }
    },
    [current, busy, idx, data],
  );

  const skip = useCallback(() => {
    setMsg(null);
    setIdx((i) => Math.min(i + 1, (data?.items.length ?? 1) - 1));
  }, [data]);

  const cleanup = async () => {
    setBusy(true);
    setMsg("Scanning pending for rejected hashes…");
    try {
      const res = await fetch("/api/admin/pending/cleanup", { method: "POST" });
      const r = await res.json();
      setMsg(`Cleaned up: scanned ${r.scanned}, deleted ${r.deleted}.`);
      void load();
      setReviewed(0);
    } finally {
      setBusy(false);
    }
  };

  // Keyboard shortcuts: A=accept, R=reject, S=skip.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (k === "a") { e.preventDefault(); void review("accept"); }
      else if (k === "r") { e.preventDefault(); void review("reject"); }
      else if (k === "s") { e.preventDefault(); skip(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, review, skip]);

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar: filters + cleanup */}
      <div className="flex flex-wrap gap-2 items-center">
        <FilterPill active={!labelFilter} onClick={() => { setLabelFilter(undefined); setReviewed(0); }}>
          All ({data?.total ?? 0})
        </FilterPill>
        <FilterPill active={labelFilter === "ai"} onClick={() => { setLabelFilter("ai"); setReviewed(0); }}>
          AI
        </FilterPill>
        <FilterPill active={labelFilter === "real"} onClick={() => { setLabelFilter("real"); setReviewed(0); }}>
          Real
        </FilterPill>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 ml-auto"
          onClick={cleanup}
          disabled={busy}
        >
          <Trash2 className="size-4" /> Clean up rejected
        </Button>
      </div>

      {reviewed > 0 && (
        <p className="text-sm text-muted-foreground">
          Reviewed {reviewed} this session · {(data?.total ?? 0)} remaining
        </p>
      )}

      {loading && !data ? (
        <div className="flex justify-center py-12">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : current ? (
        <div className="flex flex-col items-center gap-4">
          <div className="relative max-w-xl w-full rounded-lg border overflow-hidden bg-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- admin-only preview */}
            <img
              key={current.key}
              src={`/api/admin/pending/img?key=${encodeURIComponent(current.key)}`}
              alt={current.key}
              className="w-full max-h-[60vh] object-contain"
              draggable={false}
            />
            <div className="absolute top-2 left-2 flex gap-1">
              <Badge variant={current.label === "ai" ? "default" : "secondary"}>
                {current.label === "ai" ? "AI" : "Real"}
              </Badge>
            </div>
          </div>
          <p className="text-xs font-mono text-muted-foreground max-w-xl truncate">
            {current.key}
          </p>
          <div className="flex gap-2">
            <Button
              variant="default"
              className="gap-1.5"
              onClick={() => review("accept")}
              disabled={busy}
            >
              <Check className="size-4" /> Accept <kbd className="text-[10px] opacity-60">A</kbd>
            </Button>
            <Button
              variant="destructive"
              className="gap-1.5"
              onClick={() => review("reject")}
              disabled={busy}
            >
              <X className="size-4" /> Reject <kbd className="text-[10px] opacity-60">R</kbd>
            </Button>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={skip}
              disabled={busy || idx >= (data?.items.length ?? 1) - 1}
            >
              <Forward className="size-4" /> Skip <kbd className="text-[10px] opacity-60">S</kbd>
            </Button>
          </div>
          {msg && (
            <p className="text-sm text-muted-foreground bg-muted rounded-md px-3 py-2">{msg}</p>
          )}
        </div>
      ) : (
        <p className="text-center text-sm text-muted-foreground py-12">
          No pending images to review. 🎉
        </p>
      )}
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
                className="w-10 h-10 rounded object-contain bg-muted"
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
