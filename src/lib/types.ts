export type Label = "ai" | "real";

export type Mode = "easy" | "hard";

export type Verdict = "left" | "right" | "both" | "none";

export interface CatalogEntry {
  id: string;
  absPath: string;
  ext: string;
  mime: string;
  label: Label;
}

export interface RoundResponse {
  leftId: string;
  rightId: string;
  token: string;
  mode: Mode;
}

export interface GuessResponse {
  correct: boolean;
  truth: Verdict;
  /** Running server-side score after this guess. */
  correctSoFar: number;
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

export interface ScoreStats {
  total: number;
  rank: number;
  tiedWith: number;
  percentile: number;
  mean: number;
  median: number;
  yourScore: number;
  distribution: Bucket[];
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
