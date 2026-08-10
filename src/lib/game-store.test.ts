import { describe, expect, it } from "vitest";
import { startGame, resolveGame, recordGuess, consumeGame } from "./game-store";

describe("game-store", () => {
  describe("startGame", () => {
    it("issues a resolvable token and creates state", () => {
      const { gameToken, state } = startGame("easy");
      expect(state.mode).toBe("easy");
      expect(state.correct).toBe(0);
      expect(state.total).toBe(0);
      const resolved = resolveGame(gameToken);
      expect(resolved).not.toBeNull();
      expect(resolved!.id).toBe(state.id);
    });
  });

  describe("recordGuess", () => {
    it("increments correct and total on a correct guess", () => {
      const { gameToken } = startGame("easy");
      const state = recordGuess(gameToken, true);
      expect(state!.correct).toBe(1);
      expect(state!.total).toBe(1);
    });

    it("increments only total on an incorrect guess", () => {
      const { gameToken } = startGame("easy");
      const state = recordGuess(gameToken, false);
      expect(state!.correct).toBe(0);
      expect(state!.total).toBe(1);
    });

    it("accumulates across multiple guesses", () => {
      const { gameToken } = startGame("hard");
      recordGuess(gameToken, true);
      recordGuess(gameToken, false);
      recordGuess(gameToken, true);
      const state = recordGuess(gameToken, true);
      expect(state!.correct).toBe(3);
      expect(state!.total).toBe(4);
    });

    it("returns null for an invalid token", () => {
      expect(recordGuess("garbage", true)).toBeNull();
    });
  });

  describe("consumeGame", () => {
    it("returns the state and deletes it (one-shot)", () => {
      const { gameToken } = startGame("easy");
      recordGuess(gameToken, true);
      const consumed = consumeGame(gameToken);
      expect(consumed).not.toBeNull();
      expect(consumed!.correct).toBe(1);
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
