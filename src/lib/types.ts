export type Label = "ai" | "real";

export type Mode = "easy" | "hard";

/** Which side the player thinks is AI. Exactly one AI + one real per round. */
export type Verdict = "left" | "right";

export interface CatalogEntry {
  id: string;
  sha1: string;
  /** @deprecated use `locator` + `source` (kept for the fs-only image proxy). */
  absPath: string;
  locator: string;
  source: "fs" | "s3";
  ext: string;
  mime: string;
  label: Label;
  elo: number;
  appearances: number;
  fools: number;
  retired: boolean;
}

export interface RoundResponse {
  leftId: string;
  rightId: string;
  token: string;
  mode: Mode;
}

export interface GuessResponse {
  /** Server-tracked round count after this guess. No truth/correct leak. */
  totalSoFar: number;
}

export interface StartResponse {
  gameToken: string;
  mode: Mode;
}

export interface Bucket {
  lo: number;
  hi: number;
  count: number;
}

export interface RoundHistoryEntry {
  leftId: string;
  rightId: string;
  truth: Verdict;
  guess: Verdict;
  correct: boolean;
  timeMs?: number;
}

export interface ScoreStats {
  total: number;
  rank: number;
  tiedWith: number;
  percentile: number;
  mean: number;
  median: number;
  yourScore: number;
  distribution: Bucket[];
  /** Per-round truth + guess for the end-of-game review gallery. */
  rounds: RoundHistoryEntry[];
  /** Average decision time across all rounds (ms). */
  avgTimeMs: number;
  /** Population standard deviation of decision times (ms). */
  timeStdDevMs: number;
}

export interface LeaderboardEntry {
  score: number;
  correct: number;
  total: number;
  mode: Mode;
  ts: number;
}

export interface LeaderboardPreview {
  totalGames: number;
  meanScore: number;
  top: LeaderboardEntry[];
}
