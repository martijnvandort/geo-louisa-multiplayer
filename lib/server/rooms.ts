import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getPlace, pickPlaceIds, quizPlaceMode, type PlaceMode } from "@/data/catalog";
import type { QuestionCategory } from "@/data/question-categories";
import { quizCard, quizPool } from "@/data/quiz";
import type { MapDifficulty } from "@/lib/game-engine";
import { revealPlace, scoreGuess, type GuessWire } from "@/lib/game-engine";
import { GUESS_MS, RESULT_MS } from "@/lib/geo";
import type { LocaleId } from "@/lib/i18n";
import { mapPrompt } from "@/lib/map-prompt";
import { rememberLand } from "@/lib/country-shapes";
import { createRoomCode, displayName, isRoomCode, normalizeRoomCode, randomSeed } from "@/lib/room";
import type {
  PublicQuestion,
  PublicRoom,
  QuestionStep,
  RecapAnswer,
  RecapQuestion,
  RevealedPin,
  RoomPlayer,
  RoomSettings,
  ScoreRow,
} from "@/lib/room-types";

const MAX_PLAYERS = 24;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const LOCK_STALE_MS = 5_000;

export class RoomError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

interface StoredAnswer {
  playerId: string;
  name: string;
  roundIndex: number;
  step: QuestionStep;
  choice: string | null;
  coordinates: [number, number] | null;
  place: string | null;
  confirmed: boolean;
  timeRemaining: number;
  submittedAt: number;
  correct: boolean;
  points: number;
  distanceKm: number | null;
}

interface StoredQuestion {
  roundIndex: number;
  step: QuestionStep;
  prompt: string;
  startedAt: number;
  endsAt: number | null;
  revealUntil: number | null;
}

interface Room {
  code: string;
  hostId: string;
  createdAt: number;
  startsAt: number;
  status: "lobby" | "live" | "done";
  settings: RoomSettings;
  players: { id: string; name: string; joinedAt: number }[];
  question: StoredQuestion | null;
  pending: StoredAnswer[];
  closed: RecapQuestion[];
  scoreboard: ScoreRow[];
  cityIds: string[];
}

interface Database {
  rooms: Record<string, Room>;
}

export interface CreateInput {
  playerId: string;
  name: string;
  startsAt: number;
  region: string;
  questionCategory: QuestionCategory;
  mapDifficulty: MapDifficulty;
  placeMode: PlaceMode;
  locale: LocaleId;
}

export interface SettingsInput {
  playerId: string;
  startsAt?: number;
  name?: string;
  region?: string;
  questionCategory?: QuestionCategory;
  mapDifficulty?: MapDifficulty;
  placeMode?: PlaceMode;
  locale?: LocaleId;
}

export interface AnswerInput {
  playerId: string;
  roundIndex: number;
  step: QuestionStep;
  choice?: string | null;
  coordinates?: [number, number] | null;
  place?: string | null;
}

function roomsFile(): string {
  return process.env.GEOSENSE_ROOMS_PATH || path.join(process.cwd(), ".data", "rooms.json");
}

function acquire(): number {
  const file = roomsFile();
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true });
  const lock = `${file}.lock`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return openSync(lock, "wx");
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) unlinkSync(lock);
      } catch {
        /* another process took the stale lock */
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
    }
  }
  throw new RoomError(503, "The room file is busy. Try again.");
}

function release(fd: number) {
  closeSync(fd);
  try {
    unlinkSync(`${roomsFile()}.lock`);
  } catch {
    /* already released */
  }
}

function readDb(): Database {
  try {
    const parsed = JSON.parse(readFileSync(roomsFile(), "utf8")) as Database;
    if (!parsed || typeof parsed.rooms !== "object" || parsed.rooms == null) return { rooms: {} };
    return parsed;
  } catch {
    return { rooms: {} };
  }
}

function writeDb(db: Database) {
  const file = roomsFile();
  mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(db));
  renameSync(temp, file);
}

function withDb<T>(fn: (db: Database) => T): T {
  const fd = acquire();
  try {
    const db = readDb();
    const now = Date.now();
    for (const [code, room] of Object.entries(db.rooms)) {
      if (now - room.createdAt > ROOM_TTL_MS) delete db.rooms[code];
    }
    const result = fn(db);
    writeDb(db);
    return result;
  } finally {
    release(fd);
  }
}

function requireRoom(db: Database, code: string): Room {
  const room = db.rooms[normalizeRoomCode(code)];
  if (!room) throw new RoomError(404, "That game code does not exist.");
  return room;
}

let landReady = false;

function ensureCountryLand() {
  if (landReady) return;
  const raw = readFileSync(path.join(process.cwd(), "public/countries.geojson"), "utf8");
  const collection = JSON.parse(raw) as { features: GeoJSON.Feature[] };
  rememberLand(collection.features);
  landReady = true;
}

function freshCode(db: Database): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = createRoomCode();
    if (!db.rooms[code]) return code;
  }
  throw new RoomError(503, "Could not make a game code. Try again.");
}

function namedPlayers(room: Room): RoomPlayer[] {
  return room.players.map((player) => ({ id: player.id, name: player.name }));
}

function recomputeScores(room: Room) {
  const totals = new Map<string, number>();
  for (const player of room.players) totals.set(player.id, 0);
  for (const question of room.closed) {
    for (const answer of question.answers) {
      totals.set(answer.playerId, (totals.get(answer.playerId) ?? 0) + answer.points);
    }
  }
  const previous = new Map(room.scoreboard.map((row, index) => [row.playerId, index]));
  room.scoreboard = room.players
    .map((player) => ({
      playerId: player.id,
      name: player.name,
      score: totals.get(player.id) ?? 0,
    }))
    .sort((a, b) => b.score - a.score || (previous.get(a.playerId) ?? 0) - (previous.get(b.playerId) ?? 0));
}

function askOf(room: Room) {
  return {
    category: room.settings.questionCategory,
    difficulty: room.settings.mapDifficulty,
    placeMode: room.settings.placeMode,
    region: room.settings.region,
  };
}

function openQuestion(room: Room, roundIndex: number, step: QuestionStep, now: number) {
  const cityId = room.cityIds[roundIndex];
  if (!cityId) {
    room.status = "done";
    room.question = null;
    room.pending = [];
    return;
  }
  const timed = room.settings.mapDifficulty !== "kids";
  const prompt =
    step <= 1
      ? quizCard(
          room.settings.seed,
          roundIndex,
          step === 1 ? 1 : 0,
          getPlace(cityId),
          quizPool(room.settings.region),
          room.settings.locale,
          askOf(room),
        ).prompt
      : mapPrompt(room.settings.locale, cityId, step);
  room.pending = [];
  room.question = {
    roundIndex,
    step,
    prompt,
    startedAt: now,
    endsAt: timed ? now + GUESS_MS : null,
    revealUntil: null,
  };
}

function following(room: Room, roundIndex: number, step: QuestionStep): { roundIndex: number; step: QuestionStep } | null {
  if (step === 0) return { roundIndex, step: 1 };
  if (step === 1) return { roundIndex, step: 2 };
  if (step === 2 && room.settings.region !== "world") return { roundIndex, step: 3 };
  if (roundIndex + 1 >= room.cityIds.length) return null;
  return { roundIndex: roundIndex + 1, step: 0 };
}

function timeRemaining(question: StoredQuestion, now: number): number {
  if (question.endsAt == null) return 8;
  return Math.max(0, Math.min(GUESS_MS / 1000, (question.endsAt - now) / 1000));
}

function choicePoints(correct: boolean, remaining: number, timed: boolean): number {
  if (!correct) return 0;
  if (!timed) return 1000;
  return 1000 + Math.round((200 * Math.max(0, Math.min(8, remaining))) / 8);
}

function closeChoice(room: Room) {
  const question = room.question;
  if (!question) return;
  const cityId = room.cityIds[question.roundIndex];
  if (!cityId) return;
  const card = quizCard(
    room.settings.seed,
    question.roundIndex,
    question.step === 1 ? 1 : 0,
    getPlace(cityId),
    quizPool(room.settings.region),
    room.settings.locale,
    askOf(room),
  );
  const timed = room.settings.mapDifficulty !== "kids";
  const answers: RecapAnswer[] = room.players.map((player) => {
    const pending = room.pending.find((item) => item.playerId === player.id);
    const choice = pending?.choice?.trim() ? pending.choice : null;
    const correct = choice != null && choice === card.correct;
    const remaining = pending?.timeRemaining ?? 0;
    return {
      playerId: player.id,
      name: player.name,
      choice,
      place: null,
      confirmed: choice != null,
      correct,
      points: choicePoints(correct, remaining, timed),
      distanceKm: null,
      coordinates: null,
    };
  });
  const winner = answers
    .filter((answer) => answer.correct)
    .sort((a, b) => {
      const aTime = room.pending.find((item) => item.playerId === a.playerId)?.submittedAt ?? Number.MAX_SAFE_INTEGER;
      const bTime = room.pending.find((item) => item.playerId === b.playerId)?.submittedAt ?? Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    })[0];
  room.closed.push({
    roundIndex: question.roundIndex,
    step: question.step,
    prompt: question.prompt,
    kind: "choice",
    binary: false,
    correct: card.correct,
    winnerId: winner?.playerId ?? null,
    winnerName: winner?.name ?? null,
    answers,
  });
  recomputeScores(room);
}

function targetForPin(cityId: string, step: QuestionStep) {
  return revealPlace(getPlace(cityId), step);
}

function closePin(room: Room) {
  const question = room.question;
  if (!question) return;
  const cityId = room.cityIds[question.roundIndex];
  if (!cityId) return;
  const city = getPlace(cityId);
  const binary = question.step === 2 && city.id.includes(":province:");
  if (!binary && !city.id.includes(":province:")) ensureCountryLand();
  const target = targetForPin(cityId, question.step);
  const timed = room.settings.mapDifficulty !== "kids";
  const answers: RecapAnswer[] = room.players.map((player) => {
    const pending = room.pending.find((item) => item.playerId === player.id);
    const guess: GuessWire = {
      playerId: player.id,
      name: player.name,
      roundIndex: question.roundIndex,
      coordinates: pending?.coordinates ?? null,
      confirmed: Boolean(pending?.confirmed && pending.coordinates),
      timeRemaining: pending?.timeRemaining ?? 0,
      place: pending?.place ?? null,
    };
    const scored = scoreGuess(guess, target);
    const inside = scored.distanceKm === 0;
    const points = binary ? choicePoints(inside, guess.timeRemaining, timed) : scored.total;
    return {
      playerId: player.id,
      name: player.name,
      choice: null,
      place: guess.place,
      confirmed: guess.confirmed,
      correct: binary ? inside : guess.confirmed,
      points,
      distanceKm: binary ? (inside ? 0 : scored.distanceKm) : scored.distanceKm,
      coordinates: guess.coordinates,
    };
  });
  const winner = binary
    ? answers
        .filter((answer) => answer.correct)
        .sort((a, b) => submittedAt(room, a.playerId) - submittedAt(room, b.playerId))[0]
    : answers
        .filter((answer) => answer.confirmed)
        .sort((a, b) => b.points - a.points || submittedAt(room, a.playerId) - submittedAt(room, b.playerId))[0];
  room.closed.push({
    roundIndex: question.roundIndex,
    step: question.step,
    prompt: question.prompt,
    kind: "pin",
    binary,
    correct: binary ? city.name : null,
    winnerId: winner?.playerId ?? null,
    winnerName: winner?.name ?? null,
    answers,
  });
  recomputeScores(room);
}

function submittedAt(room: Room, playerId: string): number {
  return room.pending.find((item) => item.playerId === playerId)?.submittedAt ?? Number.MAX_SAFE_INTEGER;
}

function advance(room: Room, now: number) {
  const question = room.question;
  if (!question) return;
  const next = following(room, question.roundIndex, question.step);
  if (!next) {
    room.status = "done";
    room.question = null;
    room.pending = [];
    return;
  }
  openQuestion(room, next.roundIndex, next.step, now);
}

function everyoneAnswered(room: Room): boolean {
  const question = room.question;
  if (!question || room.players.length === 0) return false;
  return room.players.every((player) =>
    room.pending.some((answer) => answer.playerId === player.id && answer.roundIndex === question.roundIndex && answer.step === question.step),
  );
}

function tick(room: Room, now: number) {
  if (room.status === "done") return;
  if (room.status === "lobby") {
    if (now < room.startsAt || room.players.length === 0) return;
    room.cityIds = pickIds(room);
    if (room.cityIds.length === 0) return;
    room.status = "live";
    openQuestion(room, 0, 0, now);
    return;
  }
  const question = room.question;
  if (!question) return;
  if (question.revealUntil != null) {
    if (now >= question.revealUntil) advance(room, now);
    return;
  }
  const timedOut = question.endsAt != null && now >= question.endsAt;
  if (!everyoneAnswered(room) && !timedOut) return;
  if (question.step >= 2) {
    closePin(room);
    question.revealUntil = now + RESULT_MS;
    return;
  }
  closeChoice(room);
  advance(room, now);
}

function pickIds(room: Room): string[] {
  return pickPlaceIds(room.settings.seed, room.settings.region, quizPlaceMode(room.settings.region));
}

function pinsFor(room: Room): RevealedPin[] {
  const question = room.question;
  if (!question || question.revealUntil == null || question.step < 2) return [];
  const closed = room.closed.find((item) => item.roundIndex === question.roundIndex && item.step === question.step);
  if (!closed) return [];
  return closed.answers.map((answer) => ({
    playerId: answer.playerId,
    name: answer.name,
    coordinates: answer.coordinates,
    place: answer.place,
    confirmed: answer.confirmed,
    correct: answer.correct,
    points: answer.points,
    distanceKm: answer.distanceKm,
  }));
}

function publish(room: Room, now: number): PublicRoom {
  const question: PublicQuestion | null = room.question
    ? {
        roundIndex: room.question.roundIndex,
        step: room.question.step,
        prompt: room.question.prompt,
        startedAt: room.question.startedAt,
        endsAt: room.question.endsAt,
        revealUntil: room.question.revealUntil,
        pins: pinsFor(room),
      }
    : null;
  return {
    code: room.code,
    hostId: room.hostId,
    startsAt: room.startsAt,
    status: room.status,
    now,
    settings: room.settings,
    players: namedPlayers(room),
    scoreboard: room.scoreboard.map((row) => ({ ...row })),
    question,
    recap: room.status === "done" ? room.closed.map(cloneRecap) : [],
    cityIds: room.cityIds.slice(),
  };
}

function cloneRecap(question: RecapQuestion): RecapQuestion {
  return {
    ...question,
    answers: question.answers.map((answer) => ({
      ...answer,
      coordinates: answer.coordinates ? [answer.coordinates[0], answer.coordinates[1]] : null,
    })),
  };
}

function finiteTime(value: unknown, fallback: number): number {
  const time = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(time)) return fallback;
  const max = Date.now() + 7 * 24 * 60 * 60 * 1000;
  return Math.min(max, Math.max(Date.now() - 60_000, time));
}

export function createRoom(input: CreateInput): PublicRoom {
  const playerId = input.playerId.trim();
  if (!playerId) throw new RoomError(400, "Missing player.");
  const name = displayName(input.name, "Host");
  return withDb((db) => {
    const now = Date.now();
    const code = freshCode(db);
    const room: Room = {
      code,
      hostId: playerId,
      createdAt: now,
      startsAt: finiteTime(input.startsAt, now + 10 * 60 * 1000),
      status: "lobby",
      settings: {
        region: input.region || "world",
        questionCategory: input.questionCategory,
        mapDifficulty: input.mapDifficulty,
        placeMode: input.placeMode,
        locale: input.locale === "nl" ? "nl" : "en",
        seed: randomSeed(),
      },
      players: [{ id: playerId, name, joinedAt: now }],
      question: null,
      pending: [],
      closed: [],
      scoreboard: [],
      cityIds: [],
    };
    recomputeScores(room);
    db.rooms[code] = room;
    tick(room, now);
    return publish(room, now);
  });
}

export function readRoom(code: string): PublicRoom {
  if (!isRoomCode(normalizeRoomCode(code))) throw new RoomError(404, "That game code does not exist.");
  return withDb((db) => {
    const now = Date.now();
    const room = requireRoom(db, code);
    tick(room, now);
    return publish(room, now);
  });
}

export function joinRoom(code: string, playerId: string, name: string): PublicRoom {
  const id = playerId.trim();
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!id) throw new RoomError(400, "Missing player.");
  if (!trimmed) throw new RoomError(400, "Enter a name.");
  return withDb((db) => {
    const now = Date.now();
    const room = requireRoom(db, code);
    tick(room, now);
    const existing = room.players.find((player) => player.id === id);
    if (room.status !== "lobby" && !existing) {
      throw new RoomError(409, "This game has already started.");
    }
    if (existing) {
      existing.name = displayName(trimmed, existing.name);
    } else {
      if (room.players.length >= MAX_PLAYERS) throw new RoomError(409, "This game is full.");
      room.players.push({ id, name: displayName(trimmed, "Player"), joinedAt: now });
    }
    recomputeScores(room);
    return publish(room, now);
  });
}

export function updateRoom(code: string, input: SettingsInput): PublicRoom {
  return withDb((db) => {
    const now = Date.now();
    const room = requireRoom(db, code);
    tick(room, now);
    if (input.playerId !== room.hostId) throw new RoomError(403, "Only the host can change the game.");
    if (room.status !== "lobby") return publish(room, now);
    if (input.startsAt != null) room.startsAt = finiteTime(input.startsAt, room.startsAt);
    if (input.region) room.settings.region = input.region;
    if (input.questionCategory) room.settings.questionCategory = input.questionCategory;
    if (input.mapDifficulty) room.settings.mapDifficulty = input.mapDifficulty;
    if (input.placeMode) room.settings.placeMode = input.placeMode;
    if (input.locale) room.settings.locale = input.locale === "nl" ? "nl" : "en";
    if (typeof input.name === "string") {
      const host = room.players.find((player) => player.id === room.hostId);
      if (host) host.name = displayName(input.name, "Host");
    }
    recomputeScores(room);
    tick(room, now);
    return publish(room, now);
  });
}

export function answerRoom(code: string, input: AnswerInput): PublicRoom {
  return withDb((db) => {
    const now = Date.now();
    const room = requireRoom(db, code);
    tick(room, now);
    const question = room.question;
    const player = room.players.find((item) => item.id === input.playerId);
    if (!question || !player || room.status !== "live") return publish(room, now);
    if (question.revealUntil != null) return publish(room, now);
    if (input.roundIndex !== question.roundIndex || input.step !== question.step) return publish(room, now);
    if (room.pending.some((item) => item.playerId === player.id)) return publish(room, now);
    const coordinates = pair(input.coordinates);
    const choice = typeof input.choice === "string" ? input.choice.slice(0, 80) : null;
    room.pending.push({
      playerId: player.id,
      name: player.name,
      roundIndex: question.roundIndex,
      step: question.step,
      choice: question.step <= 1 ? choice : null,
      coordinates: question.step >= 2 ? coordinates : null,
      place: question.step >= 2 && typeof input.place === "string" ? input.place.slice(0, 80) : null,
      confirmed: question.step <= 1 ? Boolean(choice) : Boolean(coordinates),
      timeRemaining: timeRemaining(question, now),
      submittedAt: now,
      correct: false,
      points: 0,
      distanceKm: null,
    });
    tick(room, now);
    return publish(room, now);
  });
}

function pair(value: [number, number] | null | undefined): [number, number] | null {
  if (!value || value.length !== 2) return null;
  const lng = Number(value[0]);
  const lat = Number(value[1]);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return [lng, lat];
}
