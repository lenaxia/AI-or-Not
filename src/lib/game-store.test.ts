import { describe, expect, it } from "vitest";
import { startGame, resolveGame, recordGuess, recordRound, consumeGame } from "./game-store";

describe("game-store", () => {
  describe("startGame", () => {
    it("issues a resolvable token and creates state", () => {
      const { gameToken, state } = startGame("easy");
      expect(state.mode).toBe("easy");
      expect(state.correct).toBe(0);
      expect(state.total).toBe(0);
      expect(state.seenIds).toEqual(new Set());
      expect(state.rounds).toEqual([]);
      expect(state.guesses).toEqual([]);
      const resolved = resolveGame(gameToken);
      expect(resolved).not.toBeNull();
      expect(resolved!.id).toBe(state.id);
    });
  });

  describe("recordRound", () => {
    it("appends the round and adds IDs to seenIds", () => {
      const { gameToken, state } = startGame("easy");
      recordRound(gameToken, {
        leftId: "img-1",
        rightId: "img-2",
        truth: "left",
      });
      expect(state.rounds).toHaveLength(1);
      expect(state.rounds[0]!.truth).toBe("left");
      expect(state.seenIds.has("img-1")).toBe(true);
      expect(state.seenIds.has("img-2")).toBe(true);
    });

    it("accumulates across rounds", () => {
      const { gameToken, state } = startGame("easy");
      recordRound(gameToken, { leftId: "a", rightId: "b", truth: "left" });
      recordRound(gameToken, { leftId: "c", rightId: "d", truth: "right" });
      expect(state.rounds).toHaveLength(2);
      expect(state.seenIds.size).toBe(4);
    });

    it("returns null for an invalid token", () => {
      expect(
        recordRound("garbage", { leftId: "a", rightId: "b", truth: "left" }),
      ).toBeNull();
    });
  });

  describe("recordGuess", () => {
    it("increments correct and total on a correct guess, stores the guess", () => {
      const { gameToken } = startGame("easy");
      const state = recordGuess(gameToken, "left", true);
      expect(state!.correct).toBe(1);
      expect(state!.total).toBe(1);
      expect(state!.guesses).toHaveLength(1);
      expect(state!.guesses[0]!.guess).toBe("left");
      expect(state!.guesses[0]!.correct).toBe(true);
    });

    it("increments only total on an incorrect guess", () => {
      const { gameToken } = startGame("easy");
      const state = recordGuess(gameToken, "right", false);
      expect(state!.correct).toBe(0);
      expect(state!.total).toBe(1);
      expect(state!.guesses[0]!.correct).toBe(false);
    });

    it("accumulates across multiple guesses", () => {
      const { gameToken } = startGame("hard");
      recordGuess(gameToken, "left", true);
      recordGuess(gameToken, "right", false);
      recordGuess(gameToken, "left", true);
      const state = recordGuess(gameToken, "right", true);
      expect(state!.correct).toBe(3);
      expect(state!.total).toBe(4);
      expect(state!.guesses).toHaveLength(4);
    });

    it("returns null for an invalid token", () => {
      expect(recordGuess("garbage", "left", true)).toBeNull();
    });
  });

  describe("consumeGame", () => {
    it("returns the state with rounds+guesses and deletes it (one-shot)", () => {
      const { gameToken } = startGame("easy");
      recordRound(gameToken, { leftId: "a", rightId: "b", truth: "left" });
      recordGuess(gameToken, "left", true);
      const consumed = consumeGame(gameToken);
      expect(consumed).not.toBeNull();
      expect(consumed!.correct).toBe(1);
      expect(consumed!.rounds).toHaveLength(1);
      expect(consumed!.guesses).toHaveLength(1);
      // Second consume returns null — the game is gone.
      expect(consumeGame(gameToken)).toBeNull();
    });

    it("returns null for an invalid token", () => {
      expect(consumeGame("garbage")).toBeNull();
    });
  });

  describe("resolveGame", () => {
    it("returns null for a tampered token", () => {
      const { gameToken } = startGame("easy");
      const tampered = gameToken.slice(0, -1) + "X";
      expect(resolveGame(tampered)).toBeNull();
    });
  });
});
