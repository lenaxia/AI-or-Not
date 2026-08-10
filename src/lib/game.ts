import "server-only";
import type { Mode, RoundResponse, Verdict } from "./types";
import { pickByLabel } from "./catalog";
import { sign, verify } from "./crypto";

interface RoundTokenPayload {
  l: string; // left image id
  r: string; // right image id
  t: Verdict; // truth
  m: Mode;
  ts: number;
}

// Weighted truth distribution. Left/right dominate so the core loop is
// "spot the AI image"; both/none appear occasionally to keep it honest.
const WEIGHTS: Array<[Verdict, number]> = [
  ["left", 0.4],
  ["right", 0.4],
  ["both", 0.1],
  ["none", 0.1],
];

function rollTruth(): Verdict {
  const r = Math.random();
  let acc = 0;
  for (const [v, w] of WEIGHTS) {
    acc += w;
    if (r <= acc) return v;
  }
  return "right";
}

export interface BuiltRound {
  response: RoundResponse;
  truth: Verdict;
}

export async function buildRound(mode: Mode): Promise<BuiltRound | null> {
  const truth = rollTruth();

  let leftLabel: "ai" | "real";
  let rightLabel: "ai" | "real";
  let needDistinct = false;

  switch (truth) {
    case "left":
      leftLabel = "ai";
      rightLabel = "real";
      break;
    case "right":
      leftLabel = "real";
      rightLabel = "ai";
      break;
    case "both":
      leftLabel = "ai";
      rightLabel = "ai";
      needDistinct = true;
      break;
    case "none":
      leftLabel = "real";
      rightLabel = "real";
      needDistinct = true;
      break;
  }

  const left = await pickByLabel(leftLabel);
  if (!left) return null;
  const right = await pickByLabel(rightLabel, needDistinct ? left.id : undefined);
  if (!right) return null;

  const payload: RoundTokenPayload = {
    l: left.id,
    r: right.id,
    t: truth,
    m: mode,
    ts: Date.now(),
  };

  return {
    truth,
    response: {
      leftId: left.id,
      rightId: right.id,
      token: sign(payload),
      mode,
    },
  };
}

export function decodeToken(token: string): RoundTokenPayload | null {
  return verify<RoundTokenPayload>(token);
}
