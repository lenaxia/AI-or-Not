"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Brain,
  Check,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trophy,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import Distribution from "./Distribution";
import type {
  LeaderboardPreview,
  Mode,
  RoundHistoryEntry,
  RoundResponse,
  ScoreStats,
  Verdict,
} from "@/lib/types";

const TOTAL_ROUNDS = 10;
const HARD_REVEAL_MS = 2000;

type Phase = "start" | "loading" | "playing" | "finished";
/** Hard-mode reveal sequence: left image, then right, then both hidden. */
type HardReveal = "left" | "right" | "hidden";

export default function Game() {
  const [phase, setPhase] = useState<Phase>("start");
  const [mode, setMode] = useState<Mode>("easy");
  const [round, setRound] = useState(0);
  const [current, setCurrent] = useState<RoundResponse | null>(null);
  const [hardReveal, setHardReveal] = useState<HardReveal | null>(null);
  const [stats, setStats] = useState<ScoreStats | null>(null);
  const [preview, setPreview] = useState<LeaderboardPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const gameTokenRef = useRef<string | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const roundStartRef = useRef<number>(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/leaderboard");
        if (!cancelled && res.ok) setPreview(await res.json());
      } catch {
        /* preview is non-critical */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const clearTimers = () => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  };
  useEffect(() => () => clearTimers(), []);

  const fetchRound = useCallback(async (m: Mode) => {
    const gameToken = gameTokenRef.current;
    if (!gameToken) {
      setError("Game session lost. Please restart.");
      setPhase("start");
      return null;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/game/round?mode=${m}&gameToken=${encodeURIComponent(gameToken)}`,
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Could not load images.");
        setPhase("start");
        setBusy(false);
        return null;
      }
      setCurrent(data as RoundResponse);
      clearTimers();
      if (m === "hard") {
        // Sequential reveal: left for 2s → right for 2s → both hidden.
        // Timer starts AFTER the reveal sequence ends (when player can decide).
        setHardReveal("left");
        timersRef.current.push(
          setTimeout(() => setHardReveal("right"), HARD_REVEAL_MS),
        );
        timersRef.current.push(
          setTimeout(() => {
            setHardReveal("hidden");
            roundStartRef.current = Date.now();
          }, HARD_REVEAL_MS * 2),
        );
      } else {
        setHardReveal(null);
        roundStartRef.current = Date.now();
      }
      setBusy(false);
      return data as RoundResponse;
    } catch {
      setError("Network error loading round.");
      setPhase("start");
      setBusy(false);
      return null;
    }
  }, []);

  const startGame = async (m: Mode) => {
    setMode(m);
    setRound(1);
    setPhase("loading");
    setError(null);
    try {
      const startRes = await fetch("/api/game/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: m }),
      });
      if (!startRes.ok) {
        const data = await startRes.json().catch(() => ({}));
        setError(data.message ?? "Could not start game.");
        setPhase("start");
        return;
      }
      const { gameToken } = await startRes.json();
      gameTokenRef.current = gameToken;
    } catch {
      setError("Network error starting game.");
      setPhase("start");
      return;
    }
    const ok = await fetchRound(m);
    if (ok) setPhase("playing");
  };

  // Click an image = submit that side as the AI guess.
  const pickSide = async (v: Verdict) => {
    if (!current || phase !== "playing" || busy) return;
    // In hard mode, block clicks during the reveal sequence.
    if (mode === "hard" && hardReveal !== "hidden") return;
    const gameToken = gameTokenRef.current;
    if (!gameToken) {
      setError("Game session lost. Please restart.");
      setPhase("start");
      return;
    }
    const timeMs = roundStartRef.current
      ? Date.now() - roundStartRef.current
      : undefined;
    setBusy(true);
    clearTimers();
    try {
      const res = await fetch("/api/game/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: current.token, guess: v, gameToken, timeMs }),
      });
      await res.json();
    } catch {
      setError("Network error submitting guess.");
    }

    if (round >= TOTAL_ROUNDS) {
      setPhase("loading");
      try {
        const res = await fetch("/api/leaderboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gameToken }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.message ?? "Could not save score.");
          setPhase("start");
          return;
        }
        setStats(data as ScoreStats);
        setPhase("finished");
        gameTokenRef.current = null;
        (async () => {
          try {
            const p = await fetch("/api/leaderboard");
            if (p.ok) setPreview(await p.json());
          } catch { /* non-critical */ }
        })();
      } catch {
        setError("Could not save score.");
        setPhase("finished");
      }
      setBusy(false);
      return;
    }

    setRound((r) => r + 1);
    setPhase("loading");
    const ok = await fetchRound(mode);
    if (ok) setPhase("playing");
    setBusy(false);
  };

  const restart = () => {
    clearTimers();
    setPhase("start");
    setCurrent(null);
    setStats(null);
    setRound(0);
    setHardReveal(null);
    gameTokenRef.current = null;
  };

  // ---------- START SCREEN ----------
  if (phase === "start") {
    return (
      <StartScreen
        mode={mode}
        setMode={setMode}
        onStart={() => void startGame(mode)}
        preview={preview}
        error={error}
      />
    );
  }

  // ---------- FINISHED SCREEN ----------
  if (phase === "finished" && stats) {
    return (
      <FinishedScreen
        stats={stats}
        mode={mode}
        onRestart={restart}
      />
    );
  }

  // ---------- PLAYING / LOADING ----------
  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-6">
      <Header
        round={round}
        total={TOTAL_ROUNDS}
        mode={mode}
        onQuit={restart}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
        <ClickableImagePanel
          id={current?.leftId}
          side="left"
          showImage={
            phase === "playing" &&
            (mode === "easy" || hardReveal === "left" || hardReveal === "hidden")
          }
          showPlaceholder={
            phase === "playing" &&
            mode === "hard" &&
            hardReveal === "hidden"
          }
          disabled={
            busy ||
            phase !== "playing" ||
            (mode === "hard" && hardReveal !== "hidden")
          }
          onPick={() => void pickSide("left")}
        />
        <ClickableImagePanel
          id={current?.rightId}
          side="right"
          showImage={
            phase === "playing" &&
            (mode === "easy" || hardReveal === "right" || hardReveal === "hidden")
          }
          showPlaceholder={
            phase === "playing" &&
            mode === "hard" &&
            hardReveal === "hidden"
          }
          disabled={
            busy ||
            phase !== "playing" ||
            (mode === "hard" && hardReveal !== "hidden")
          }
          onPick={() => void pickSide("right")}
        />
      </div>

      <div className="mt-6">
        {phase === "playing" ? (
          mode === "hard" && hardReveal !== "hidden" ? (
            <p className="text-center text-sm text-amber-600 dark:text-amber-500 h-9 flex items-center justify-center gap-2">
              <Eye className="size-4" />{" "}
              {hardReveal === "left"
                ? "Left image — memorize!"
                : "Right image — memorize!"}
            </p>
          ) : mode === "hard" && hardReveal === "hidden" ? (
            <p className="text-center text-sm text-muted-foreground h-9 flex items-center justify-center gap-2">
              <EyeOff className="size-4" /> Both hidden — pick from memory!
            </p>
          ) : (
            <p className="text-center text-sm text-muted-foreground h-9 flex items-center justify-center">
              Click the image you think is AI-generated
            </p>
          )
        ) : (
          <div className="h-9 flex items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- SUBCOMPONENTS ----------

function Header({
  round,
  total,
  mode,
  onQuit,
}: {
  round: number;
  total: number;
  mode: Mode;
  onQuit: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-4">
        <Badge variant="secondary" className="gap-1">
          <Brain className="size-3.5" /> {mode === "hard" ? "Hard" : "Easy"}
        </Badge>
        <Button variant="ghost" size="sm" onClick={onQuit} className="gap-1">
          <RotateCcw className="size-3.5" /> Quit
        </Button>
      </div>
      <div className="flex items-center justify-between text-sm text-muted-foreground mt-3 mb-2">
        <span>
          Round {round} / {total}
        </span>
      </div>
      <Progress value={(round / total) * 100} />
    </div>
  );
}

function ClickableImagePanel({
  id,
  side,
  showImage,
  showPlaceholder,
  disabled,
  onPick,
}: {
  id?: string;
  side: "left" | "right";
  showImage: boolean;
  showPlaceholder: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      aria-label={`Pick ${side} image as AI`}
      className={`group relative block w-full text-left transition-all ${
        disabled
          ? "cursor-default"
          : "cursor-pointer hover:scale-[1.01] active:scale-[0.99]"
      }`}
    >
      <div
        className={`relative w-full overflow-hidden rounded-xl ring-1 transition-all bg-muted flex items-center justify-center ${
          disabled
            ? "ring-foreground/10"
            : "ring-foreground/10 group-hover:ring-2 group-hover:ring-primary group-focus-visible:ring-2 group-focus-visible:ring-primary"
        }`}
      >
        {id && showImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- opaque server-proxied image
          <img
            src={`/api/img/${id}`}
            alt={`${side} image`}
            className="w-full max-h-[60vh] object-contain"
            draggable={false}
          />
        ) : showPlaceholder ? (
          /* Hard mode: images hidden but panel is still clickable */
          <div className="w-full aspect-[4/3] flex flex-col items-center justify-center text-muted-foreground gap-2">
            <EyeOff className="size-10" />
            <span className="text-sm">Pick {side}</span>
          </div>
        ) : (
          <div className="w-full aspect-[4/3] flex items-center justify-center text-muted-foreground">
            <Loader2 className="size-8 animate-spin" />
          </div>
        )}
        {!disabled && showPlaceholder && (
          <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/5 transition-colors flex items-center justify-center">
            <span className="opacity-0 group-hover:opacity-100 transition-opacity text-sm font-medium bg-background/80 rounded-full px-3 py-1">
              {side === "left" ? "← This is AI" : "This is AI →"}
            </span>
          </div>
        )}
      </div>
    </button>
  );
}

function StartScreen({
  mode,
  setMode,
  onStart,
  preview,
  error,
}: {
  mode: Mode;
  setMode: (m: Mode) => void;
  onStart: () => void;
  preview: LeaderboardPreview | null;
  error: string | null;
}) {
  return (
    <div className="w-full max-w-xl mx-auto px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">AI or Not?</CardTitle>
          <CardDescription>
            Two photos appear — one is real, one is AI-generated. Spot the
            fake across {TOTAL_ROUNDS} rounds and see where you rank.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div>
            <p className="text-sm font-medium mb-2">Mode</p>
            <div className="grid grid-cols-2 gap-2">
              <ModeButton
                active={mode === "easy"}
                onClick={() => setMode("easy")}
                title="Easy"
                desc="Study each pair freely"
              />
              <ModeButton
                active={mode === "hard"}
                onClick={() => setMode("hard")}
                title="Hard"
                desc="Images vanish after 2s"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <Button size="lg" className="w-full h-12" onClick={onStart}>
            Start game
          </Button>

          {preview && preview.totalGames > 0 && (
            <>
              <Separator />
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Trophy className="size-4" /> {preview.totalGames} games played
                </span>
                <span className="text-muted-foreground">
                  avg score {preview.meanScore}%
                </span>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-lg border p-3 transition-colors ${
        active
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border hover:bg-muted"
      }`}
    >
      <span className="block font-medium">{title}</span>
      <span className="block text-xs text-muted-foreground">{desc}</span>
    </button>
  );
}

function FinishedScreen({
  stats,
  mode,
  onRestart,
}: {
  stats: ScoreStats;
  mode: Mode;
  onRestart: () => void;
}) {
  const correct = stats.rounds.filter((r) => r.correct).length;
  const total = stats.rounds.length;
  const beat = stats.percentile;
  const topPct = Math.round((100 - beat) * 10) / 10;
  return (
    <div className="w-full max-w-2xl mx-auto px-4 py-10">
      <Card>
        <CardHeader className="text-center">
          <Trophy className="size-8 mx-auto text-amber-500" />
          <div className="text-5xl font-bold tabular-nums mt-2">
            {stats.yourScore}%
          </div>
          <CardDescription className="text-base">
            {correct} of {total} correct in {mode} mode
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Rank" value={`#${stats.rank}`} />
            <Stat label="Percentile" value={`Top ${topPct}%`} />
            <Stat label="Avg (this mode)" value={`${stats.mean}%`} />
          </div>

          {stats.avgTimeMs > 0 && (
            <div className="grid grid-cols-2 gap-3 text-center">
              <Stat
                label="Avg decision time"
                value={`${(stats.avgTimeMs / 1000).toFixed(1)}s`}
              />
              <Stat
                label="Std deviation"
                value={`±${(stats.timeStdDevMs / 1000).toFixed(1)}s`}
              />
            </div>
          )}

          <div>
            <p className="text-sm font-medium mb-2">
              Where you sit ({stats.total} {mode} games)
            </p>
            <Distribution buckets={stats.distribution} yourScore={stats.yourScore} />
          </div>

          {stats.rounds.length > 0 && (
            <ReviewGallery rounds={stats.rounds} />
          )}

          <Button size="lg" className="w-full h-12 gap-2" onClick={onRestart}>
            <RefreshCw className="size-4" /> Play again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function ReviewGallery({ rounds }: { rounds: RoundHistoryEntry[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <div>
      <Separator className="mb-4" />
      <p className="text-sm font-medium mb-3">Review — click any round to enlarge</p>
      <div className="flex flex-col gap-2">
        {rounds.map((r, i) => (
          <ReviewRow
            key={i}
            index={i + 1}
            entry={r}
            onSelect={() => setSelected(i)}
          />
        ))}
      </div>
      {selected !== null && rounds[selected] && (
        <ReviewModal
          entry={rounds[selected]!}
          index={selected + 1}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function ReviewRow({
  index,
  entry,
  onSelect,
}: {
  index: number;
  entry: RoundHistoryEntry;
  onSelect: () => void;
}) {
  const leftIsAi = entry.truth === "left";
  const pickedLeft = entry.guess === "left";
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex items-center gap-3 rounded-lg border p-2 w-full text-left hover:bg-muted transition-colors"
    >
      {/* Index + correctness + time on the left */}
      <div className="flex flex-col items-center gap-1 shrink-0 w-16 justify-center">
        <span className="text-sm font-semibold text-muted-foreground tabular-nums">
          {index}
        </span>
        {entry.correct ? (
          <Check className="size-5 text-emerald-500" />
        ) : (
          <X className="size-5 text-destructive" />
        )}
        {typeof entry.timeMs === "number" && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {(entry.timeMs / 1000).toFixed(1)}s
          </span>
        )}
      </div>
      {/* Thumbnails */}
      <div className="flex gap-2 flex-1 min-w-0">
        <ReviewThumb id={entry.leftId} isAi={leftIsAi} picked={pickedLeft} />
        <ReviewThumb id={entry.rightId} isAi={!leftIsAi} picked={!pickedLeft} />
      </div>
    </button>
  );
}

function ReviewThumb({
  id,
  isAi,
  picked,
}: {
  id: string;
  isAi: boolean;
  picked: boolean;
}) {
  return (
    <div
      className={`relative flex-1 rounded overflow-hidden ring-1 ${
        picked
          ? isAi
            ? "ring-2 ring-emerald-500"
            : "ring-2 ring-destructive"
          : "ring-foreground/10"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/img/${id}`}
        alt=""
        className="w-full h-16 object-contain bg-muted"
        draggable={false}
      />
      <div className="absolute bottom-1 left-1 flex items-center gap-1">
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
            isAi
              ? "bg-blue-600 text-white"
              : "bg-emerald-600 text-white"
          }`}
        >
          {isAi ? "AI" : "REAL"}
        </span>
        {picked && (
          <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full bg-amber-500 text-white">
            PICKED
          </span>
        )}
      </div>
    </div>
  );
}

function ReviewModal({
  entry,
  index,
  onClose,
}: {
  entry: RoundHistoryEntry;
  index: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const leftIsAi = entry.truth === "left";
  const pickedLeft = entry.guess === "left";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/70 p-2 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative bg-background rounded-xl shadow-xl w-full max-w-3xl my-auto p-3 sm:p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3 sm:mb-4">
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="text-base sm:text-lg font-semibold">Round {index}</span>
            {entry.correct ? (
              <span className="flex items-center gap-1 text-emerald-500 font-medium text-sm sm:text-base">
                <Check className="size-4 sm:size-5" /> Correct
              </span>
            ) : (
              <span className="flex items-center gap-1 text-destructive font-medium text-sm sm:text-base">
                <X className="size-4 sm:size-5" /> Incorrect
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded hover:bg-muted transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Images: stacked on mobile, side-by-side on sm+ */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
          <ReviewModalImage id={entry.leftId} isAi={leftIsAi} picked={pickedLeft} side="Left" />
          <ReviewModalImage id={entry.rightId} isAi={!leftIsAi} picked={!pickedLeft} side="Right" />
        </div>
      </div>
    </div>
  );
}

function ReviewModalImage({
  id,
  isAi,
  picked,
  side,
}: {
  id: string;
  isAi: boolean;
  picked: boolean;
  side: string;
}) {
  return (
    <div
      className={`relative rounded-lg overflow-hidden ring-2 ${
        picked
          ? isAi
            ? "ring-emerald-500"
            : "ring-destructive"
          : "ring-transparent"
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/img/${id}`}
        alt={`${side} image`}
        className="w-full max-h-[40vh] sm:max-h-[50vh] object-contain bg-muted"
        draggable={false}
      />
      <div className="absolute top-2 left-2 flex gap-1">
        <span
          className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            isAi
              ? "bg-blue-600 text-white"
              : "bg-emerald-600 text-white"
          }`}
        >
          {isAi ? "AI" : "Real"}
        </span>
        {picked && (
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500 text-white">
            YOUR PICK
          </span>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
