"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Brain,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trophy,
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
  GuessResponse,
  LeaderboardPreview,
  Mode,
  RoundResponse,
  ScoreStats,
  Verdict,
} from "@/lib/types";

const TOTAL_ROUNDS = 10;
const HARD_REVEAL_MS = 2000;

type Phase = "start" | "loading" | "playing" | "reveal" | "finished";

const VERDICTS: { value: Verdict; label: string }[] = [
  { value: "left", label: "← Left is AI" },
  { value: "right", label: "Right is AI →" },
  { value: "both", label: "Both are AI" },
  { value: "none", label: "Neither is AI" },
];

function truthLabels(truth: Verdict): { left: "ai" | "real"; right: "ai" | "real" } {
  switch (truth) {
    case "left":
      return { left: "ai", right: "real" };
    case "right":
      return { left: "real", right: "ai" };
    case "both":
      return { left: "ai", right: "ai" };
    case "none":
      return { left: "real", right: "real" };
  }
}

export default function Game() {
  const [phase, setPhase] = useState<Phase>("start");
  const [mode, setMode] = useState<Mode>("easy");
  const [round, setRound] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [current, setCurrent] = useState<RoundResponse | null>(null);
  const [result, setResult] = useState<GuessResponse | null>(null);
  const [guess, setGuess] = useState<Verdict | null>(null);
  const [hidden, setHidden] = useState(false);
  const [stats, setStats] = useState<ScoreStats | null>(null);
  const [preview, setPreview] = useState<LeaderboardPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const gameTokenRef = useRef<string | null>(null);
  const hardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadPreview = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard");
      if (res.ok) setPreview(await res.json());
    } catch {
      /* preview is non-critical */
    }
  }, []);

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

  const clearHardTimer = () => {
    if (hardTimer.current) {
      clearTimeout(hardTimer.current);
      hardTimer.current = null;
    }
  };
  useEffect(() => () => clearHardTimer(), []);

  const fetchRound = useCallback(async (m: Mode) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/game/round?mode=${m}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.message ?? "Could not load images.");
        setPhase("start");
        setBusy(false);
        return null;
      }
      setCurrent(data as RoundResponse);
      setGuess(null);
      setResult(null);
      if (m === "hard") {
        setHidden(false);
        clearHardTimer();
        hardTimer.current = setTimeout(() => setHidden(true), HARD_REVEAL_MS);
      } else {
        setHidden(false);
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
    setCorrect(0);
    setPhase("loading");
    setError(null);
    // Issue a server-side game session. The server will track the score;
    // the client just holds the token.
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

  const submitGuess = async (v: Verdict) => {
    if (!current || phase !== "playing" || busy) return;
    const gameToken = gameTokenRef.current;
    if (!gameToken) {
      setError("Game session lost. Please restart.");
      setPhase("start");
      return;
    }
    setBusy(true);
    setGuess(v);
    clearHardTimer();
    try {
      const res = await fetch("/api/game/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: current.token, guess: v, gameToken }),
      });
      const data = (await res.json()) as GuessResponse;
      setResult(data);
      // Use the server's authoritative count, not a local increment.
      setCorrect(data.correctSoFar);
      setPhase("reveal");
    } catch {
      setError("Network error submitting guess.");
    } finally {
      setBusy(false);
    }
  };

  const nextRound = async () => {
    if (round >= TOTAL_ROUNDS) {
      setPhase("loading");
      const gameToken = gameTokenRef.current;
      if (!gameToken) {
        setError("Game session lost.");
        setPhase("start");
        return;
      }
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
        void loadPreview();
      } catch {
        setError("Could not save score.");
        setPhase("finished");
      }
      return;
    }
    setRound((r) => r + 1);
    setPhase("loading");
    const ok = await fetchRound(mode);
    if (ok) setPhase("playing");
  };

  const restart = () => {
    clearHardTimer();
    setPhase("start");
    setCurrent(null);
    setResult(null);
    setStats(null);
    setGuess(null);
    setRound(0);
    setCorrect(0);
    setHidden(false);
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
        correct={correct}
        total={TOTAL_ROUNDS}
        mode={mode}
        onRestart={restart}
      />
    );
  }

  // ---------- PLAYING / REVEAL / LOADING ----------
  const truth = result?.truth;
  const labels = truth ? truthLabels(truth) : null;
  const showTruth = phase === "reveal";

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-6">
      <Header
        round={round}
        total={TOTAL_ROUNDS}
        correct={correct}
        mode={mode}
        onQuit={restart}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
        <ImagePanel
          id={current?.leftId}
          side="Left"
          hidden={hidden && phase === "playing"}
          showTruth={showTruth}
          isAi={labels?.left === "ai"}
          guessedAi={guess === "left" || guess === "both"}
        />
        <ImagePanel
          id={current?.rightId}
          side="Right"
          hidden={hidden && phase === "playing"}
          showTruth={showTruth}
          isAi={labels?.right === "ai"}
          guessedAi={guess === "right" || guess === "both"}
        />
      </div>

      <div className="mt-6">
        {phase === "playing" ? (
          hidden ? (
            <p className="text-center text-sm text-muted-foreground h-9 flex items-center justify-center gap-2">
              <EyeOff className="size-4" /> Images hidden — guess from memory!
            </p>
          ) : mode === "hard" ? (
            <p className="text-center text-sm text-amber-600 dark:text-amber-500 h-9 flex items-center justify-center gap-2">
              <Eye className="size-4" /> Memorize quickly — they hide in 2s…
            </p>
          ) : (
            <p className="text-center text-sm text-muted-foreground h-9 flex items-center justify-center">
              Which image(s) were AI-generated?
            </p>
          )
        ) : showTruth && result ? (
          <div className="text-center h-9 flex items-center justify-center">
            <Badge variant={result.correct ? "default" : "destructive"}>
              {result.correct ? "Correct!" : "Wrong"}
            </Badge>
            <span className="ml-3 text-sm text-muted-foreground">
              Answer:{" "}
              {truth === "left" && "Left was AI"}
              {truth === "right" && "Right was AI"}
              {truth === "both" && "Both were AI"}
              {truth === "none" && "Neither was AI"}
            </span>
          </div>
        ) : (
          <div className="h-9 flex items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4">
        {VERDICTS.map((v) => (
          <Button
            key={v.value}
            variant="outline"
            size="lg"
            disabled={phase !== "playing" || busy}
            onClick={() => void submitGuess(v.value)}
            className="h-12"
          >
            {v.label}
          </Button>
        ))}
      </div>

      {phase === "reveal" && (
        <div className="mt-6 flex justify-center">
          <Button onClick={() => void nextRound()} size="lg" className="min-w-40">
            {round >= TOTAL_ROUNDS ? "See results" : "Next round"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------- SUBCOMPONENTS ----------

function Header({
  round,
  total,
  correct,
  mode,
  onQuit,
}: {
  round: number;
  total: number;
  correct: number;
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
        <span>
          Score: {correct}/{total}
        </span>
      </div>
      <Progress value={(round / total) * 100} />
    </div>
  );
}

function ImagePanel({
  id,
  side,
  hidden,
  showTruth,
  isAi,
  guessedAi,
}: {
  id?: string;
  side: string;
  hidden: boolean;
  showTruth: boolean;
  isAi?: boolean;
  guessedAi?: boolean;
}) {
  return (
    <div className="relative">
      <div
        className={`relative aspect-[4/3] w-full overflow-hidden rounded-xl ring-1 transition-colors bg-muted ${
          showTruth
            ? isAi
              ? "ring-emerald-500 ring-2"
              : "ring-2 ring-zinc-400"
            : "ring-foreground/10"
        }`}
      >
        {id && !hidden ? (
          // eslint-disable-next-line @next/next/no-img-element -- opaque server-proxied image; next/image adds no value here
          <img
            src={`/api/img/${id}`}
            alt={`${side} image`}
            className="absolute inset-0 size-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            {hidden ? (
              <span className="flex flex-col items-center gap-2">
                <EyeOff className="size-8" />
                <span className="text-xs">Hidden</span>
              </span>
            ) : (
              <Loader2 className="size-8 animate-spin" />
            )}
          </div>
        )}
        {showTruth && (
          <div className="absolute top-2 left-2">
            <Badge variant={isAi ? "default" : "secondary"}>
              {isAi ? "AI" : "Real"}
            </Badge>
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm font-medium">{side}</span>
        {guessedAi && showTruth && (
          <span className="text-xs text-muted-foreground">your guess: AI</span>
        )}
      </div>
    </div>
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
          <CardTitle className="text-2xl">Real or AI?</CardTitle>
          <CardDescription>
            Two photos appear. One, both, or neither may be AI-generated.
            Spot the fakes across {TOTAL_ROUNDS} rounds and see where you rank.
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
  correct,
  total,
  mode,
  onRestart,
}: {
  stats: ScoreStats;
  correct: number;
  total: number;
  mode: Mode;
  onRestart: () => void;
}) {
  const beat = stats.percentile;
  return (
    <div className="w-full max-w-xl mx-auto px-4 py-10">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl flex items-center gap-2">
            <Trophy className="size-6" /> {stats.yourScore}%
          </CardTitle>
          <CardDescription>
            {correct} of {total} correct in {mode} mode
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="grid grid-cols-3 gap-3 text-center">
            <Stat label="Rank" value={`#${stats.rank}`} />
            <Stat label="Percentile" value={`Top ${100 - beat}%`} />
            <Stat label="Avg (this mode)" value={`${stats.mean}%`} />
          </div>

          <div>
            <p className="text-sm font-medium mb-2">
              Where you sit ({stats.total} {mode} games)
            </p>
            <Distribution buckets={stats.distribution} yourScore={stats.yourScore} />
          </div>

          <Button size="lg" className="w-full h-12 gap-2" onClick={onRestart}>
            <RefreshCw className="size-4" /> Play again
          </Button>
        </CardContent>
      </Card>
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
