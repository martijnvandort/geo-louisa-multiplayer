import type { QuestionCategory } from "@/data/question-categories";
import type { PlaceMode } from "@/data/catalog";
import type { MapDifficulty } from "@/lib/game-engine";
import type { LocaleId } from "@/lib/i18n";

export type RoomStatus = "lobby" | "live" | "done";
export type QuestionStep = 0 | 1 | 2 | 3;

export interface RoomSettings {
  region: string;
  questionCategory: QuestionCategory;
  mapDifficulty: MapDifficulty;
  placeMode: PlaceMode;
  locale: LocaleId;
  seed: number;
}

export interface RoomPlayer {
  id: string;
  name: string;
}

export interface ScoreRow {
  playerId: string;
  name: string;
  score: number;
}

/** A pin that is safe to draw. Coordinates stay absent until the map question is over. */
export interface RevealedPin {
  playerId: string;
  name: string;
  coordinates: [number, number] | null;
  place: string | null;
  confirmed: boolean;
  correct: boolean;
  points: number;
  distanceKm: number | null;
}

export interface PublicQuestion {
  roundIndex: number;
  step: QuestionStep;
  prompt: string;
  startedAt: number;
  endsAt: number | null;
  revealUntil: number | null;
  pins: RevealedPin[];
}

export interface RecapAnswer {
  playerId: string;
  name: string;
  choice: string | null;
  place: string | null;
  confirmed: boolean;
  correct: boolean;
  points: number;
  distanceKm: number | null;
  coordinates: [number, number] | null;
}

export interface RecapQuestion {
  roundIndex: number;
  step: QuestionStep;
  prompt: string;
  kind: "choice" | "pin";
  binary: boolean;
  correct: string | null;
  winnerId: string | null;
  winnerName: string | null;
  answers: RecapAnswer[];
}

export interface PublicRoom {
  code: string;
  hostId: string;
  startsAt: number;
  status: RoomStatus;
  now: number;
  settings: RoomSettings;
  players: RoomPlayer[];
  scoreboard: ScoreRow[];
  question: PublicQuestion | null;
  /** Empty until the game is over, so multiple-choice text stays hidden. */
  recap: RecapQuestion[];
  cityIds: string[];
}
