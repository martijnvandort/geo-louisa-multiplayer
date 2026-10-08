"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlaceMode } from "@/data/catalog";
import type { QuestionCategory } from "@/data/question-categories";
import type { MapDifficulty } from "@/lib/game-engine";
import type { LocaleId } from "@/lib/i18n";
import type { PublicRoom, QuestionStep } from "@/lib/room-types";

export interface HostSettings {
  name: string;
  startsAt: number;
  region: string;
  questionCategory: QuestionCategory;
  mapDifficulty: MapDifficulty;
  placeMode: PlaceMode;
  locale: LocaleId;
}

function isCurrent(previous: PublicRoom | null, next: PublicRoom): boolean {
  if (!previous || previous.code !== next.code) return true;
  if (previous.status === "done") return next.status === "done";
  if (next.status === "lobby" && previous.status !== "lobby") return false;
  if (next.players.length < previous.players.length) return false;
  const before = previous.question;
  const after = next.question;
  if (before && after) {
    if (after.roundIndex < before.roundIndex) return false;
    if (after.roundIndex === before.roundIndex && after.step < before.step) return false;
    if (before.revealUntil && !after.revealUntil && after.roundIndex === before.roundIndex && after.step === before.step) {
      return false;
    }
  }
  if (before && !after && next.status !== "done") return false;
  return true;
}

async function send(url: string, body: unknown): Promise<PublicRoom> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = (await response.json()) as PublicRoom & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Could not reach that game.");
  return payload;
}

export function useSharedRoom(playerId: string) {
  const [room, setRoom] = useState<PublicRoom | null>(null);
  const [error, setError] = useState<string | null>(null);
  const codeRef = useRef<string | null>(null);
  const roomRef = useRef<PublicRoom | null>(null);

  const adopt = useCallback((next: PublicRoom) => {
    if (!isCurrent(roomRef.current, next)) return;
    roomRef.current = next;
    setRoom(next);
  }, []);

  const refresh = useCallback(async () => {
    const code = codeRef.current;
    if (!code) return;
    try {
      const response = await fetch(`/api/rooms/${code}`, { cache: "no-store" });
      const payload = (await response.json()) as PublicRoom & { error?: string };
      if (!response.ok) {
        setError(payload.error || "That game code does not exist.");
        return;
      }
      adopt(payload);
      setError(null);
    } catch {
      setError("Could not reach that game.");
    }
  }, [adopt]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refresh();
    }, 700);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const create = useCallback(
    async (settings: HostSettings) => {
      const created = await send("/api/rooms", { playerId, ...settings });
      codeRef.current = created.code;
      adopt(created);
      setError(null);
      return created;
    },
    [adopt, playerId],
  );

  const join = useCallback(
    async (code: string, name: string) => {
      const joined = await send(`/api/rooms/${code}`, { action: "join", playerId, name });
      codeRef.current = joined.code;
      adopt(joined);
      setError(null);
      return joined;
    },
    [adopt, playerId],
  );

  const update = useCallback(
    async (settings: HostSettings) => {
      const code = codeRef.current;
      if (!code) return null;
      const next = await send(`/api/rooms/${code}`, { action: "settings", playerId, ...settings });
      adopt(next);
      return next;
    },
    [adopt, playerId],
  );

  const answer = useCallback(
    async (input: {
      roundIndex: number;
      step: QuestionStep;
      choice?: string | null;
      coordinates?: [number, number] | null;
      place?: string | null;
    }) => {
      const code = codeRef.current;
      if (!code) return null;
      const next = await send(`/api/rooms/${code}`, { action: "answer", playerId, ...input });
      adopt(next);
      return next;
    },
    [adopt, playerId],
  );

  const watch = useCallback(
    (code: string) => {
      if (codeRef.current === code) return;
      codeRef.current = code;
      void refresh();
    },
    [refresh],
  );

  const leaveLocal = useCallback(() => {
    codeRef.current = null;
    roomRef.current = null;
    setRoom(null);
    setError(null);
  }, []);

  return { room, error, create, join, update, answer, watch, leaveLocal };
}
