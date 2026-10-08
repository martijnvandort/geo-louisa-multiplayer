import { getPlace, pickPlaceIds, quizPlaceMode, type PlaceMode, type PlayPlace } from "@/data/catalog";
import type { QuestionCategory } from "@/data/question-categories";
import { quizCard, quizPool } from "@/data/quiz";
import { approachPoint, distanceToCountryKm } from "@/lib/country-shapes";
import type { LocaleId } from "@/lib/i18n";
import { emptyScore, GUESS_MS, haversineKm, PREVIEW_MS, scoreFromDistance } from "@/lib/geo";
import { distanceToProvinceKm } from "@/lib/provinces";
import { displayName } from "@/lib/room";

export type Phase =
  | "LOBBY"
  | "WAITING_PLAYER"
  | "ROUND_PREVIEW"
  | "QUIZ_QUESTION"
  | "QUIZ_FEEDBACK"
  | "GUESSING_ACTIVE"
  | "ROUND_RESULT"
  | "FINAL_RESULTS";

export type MapDifficulty = "kids" | "normal" | "hard";
export type PlayFormat = "pin" | "quiz";
export type { PlaceMode };

export interface GuessWire {
  playerId: string;
  name: string;
  roundIndex: number;
  coordinates: [number, number] | null;
  confirmed: boolean;
  timeRemaining: number;
  place: string | null;
}

export interface ScoredGuess extends GuessWire {
  distanceKm: number | null;
  distanceScore: number;
  timeBonus: number;
  total: number;
}

export interface RoundRecord {
  roundIndex: number;
  cityId: string;
  guesses: ScoredGuess[];
  /** 0 is the region pin. 1 is the capital pin in a quiz. */
  part?: number;
  label?: string;
}

export interface PlayerPresence {
  id: string;
  name: string;
  role: "host" | "guest";
}

export interface LockNotice {
  playerId: string;
  name: string;
  roundIndex: number;
  timeRemaining: number;
}

export interface PublicSnapshot {
  seed: number;
  difficulty: MapDifficulty;
  region: string;
  placeMode: PlaceMode;
  rosterIds: string[];
  phase: Phase;
  roundIndex: number;
  previewStartedAt: number | null;
  guessingEndsAt: number | null;
  resultStartedAt: number | null;
  history: RoundRecord[];
}

export interface EngineState {
  phase: Phase;
  mode: "solo" | "multi" | null;
  mapDifficulty: MapDifficulty;
  playFormat: PlayFormat;
  quizStep: 0 | 1 | 2 | 3;
  quizChoice: string | null;
  quizCorrect: boolean | null;
  quizPoints: number;
  region: string;
  placeMode: PlaceMode;
  questionCategory: QuestionCategory;
  locale: LocaleId;
  nickname: string;
  localName: string;
  playerId: string;
  roomCode: string | null;
  isHost: boolean;
  players: PlayerPresence[];
  rosterIds: string[];
  seed: number | null;
  cityIds: string[];
  roundIndex: number;
  previewStartedAt: number | null;
  guessingEndsAt: number | null;
  resultStartedAt: number | null;
  pin: [number, number] | null;
  submitted: boolean;
  revealOpen: boolean;
  localGuess: GuessWire | null;
  locks: LockNotice[];
  guesses: GuessWire[];
  history: RoundRecord[];
  notice: string | null;
  connection: "idle" | "connecting" | "live" | "error";
  connectionError: string | null;
}

export type Action =
  | { type: "SET_DIFFICULTY"; difficulty: MapDifficulty }
  | { type: "SET_REGION"; region: string }
  | { type: "SET_PLACE_MODE"; placeMode: PlaceMode }
  | { type: "SET_QUESTION_CATEGORY"; questionCategory: QuestionCategory }
  | { type: "SET_NICKNAME"; nickname: string }
  | { type: "SET_LOCALE"; locale: LocaleId }
  | { type: "SET_PLAYER"; playerId: string }
  | { type: "START_SOLO"; now: number; seed: number; format?: PlayFormat }
  | { type: "QUIZ_CHOOSE"; choice: string }
  | { type: "QUIZ_TIMEOUT" }
  | { type: "QUIZ_ADVANCE"; now: number }
  | { type: "QUIZ_PIN"; coordinates: [number, number]; now: number; place: string | null }
  | { type: "QUIZ_MAP_NEXT"; now: number }
  | { type: "CREATE_ROOM"; code: string }
  | { type: "JOIN_ROOM"; code: string }
  | { type: "CONNECTION"; status: EngineState["connection"]; error?: string | null }
  | { type: "PRESENCE"; players: PlayerPresence[] }
  | {
      type: "MATCH_START";
      seed: number;
      difficulty: MapDifficulty;
      region: string;
      placeMode?: PlaceMode;
      previewStartedAt: number;
      rosterIds: string[];
    }
  | { type: "SNAPSHOT"; snapshot: PublicSnapshot }
  | { type: "BEGIN_GUESSING" }
  | { type: "PLACE_PIN"; coordinates: [number, number] }
  | { type: "RESOLVE_SOLO"; guess: GuessWire; now: number }
  | { type: "LOCAL_LOCK"; guess: GuessWire }
  | { type: "REMOTE_LOCK"; lock: LockNotice }
  | { type: "OPEN_REVEAL"; guess: GuessWire; now: number }
  | { type: "REMOTE_REVEAL"; guess: GuessWire; now: number }
  | { type: "FORCE_REVEAL"; now: number }
  | { type: "NEXT_ROUND"; roundIndex: number; previewStartedAt: number }
  | { type: "FINAL" }
  | { type: "OPPONENT_LEFT"; now: number }
  | { type: "LEAVE" }
  | { type: "PLAY_AGAIN" }
  | { type: "CLEAR_NOTICE" };

export function createInitialState(playerId = ""): EngineState {
  return {
    phase: "LOBBY",
    mode: null,
    mapDifficulty: "normal",
    playFormat: "pin",
    quizStep: 0,
    quizChoice: null,
    quizCorrect: null,
    quizPoints: 0,
    region: "world",
    placeMode: "capitals",
    questionCategory: "all",
    locale: "en",
    nickname: "",
    localName: "You",
    playerId,
    roomCode: null,
    isHost: false,
    players: [],
    rosterIds: [],
    seed: null,
    cityIds: [],
    roundIndex: 0,
    previewStartedAt: null,
    guessingEndsAt: null,
    resultStartedAt: null,
    pin: null,
    submitted: false,
    revealOpen: false,
    localGuess: null,
    locks: [],
    guesses: [],
    history: [],
    notice: null,
    connection: "idle",
    connectionError: null,
  };
}

export function scoreGuess(guess: GuessWire, place: PlayPlace): ScoredGuess {
  if (!guess.confirmed || !guess.coordinates) {
    return { ...guess, ...emptyScore() };
  }
  let distanceKm = place.id.includes(":country:")
    ? distanceToCountryKm(place.name, guess.coordinates)
    : place.id.includes(":province:")
      ? distanceToProvinceKm(place.name, guess.coordinates)
      : haversineKm(guess.coordinates, place.coordinates);
  if (!Number.isFinite(distanceKm)) distanceKm = haversineKm(guess.coordinates, place.coordinates);
  return { ...guess, distanceKm, ...scoreFromDistance(distanceKm, guess.timeRemaining) };
}

/** Step 3 asks for the capital. Earlier pin steps keep the country or division. */
export function revealPlace(place: PlayPlace, step: number): PlayPlace {
  if (step !== 3) return place;
  return {
    ...place,
    id: place.id.replace(":province:", ":capital:").replace(":country:", ":capital:"),
    name: place.capitalName ?? place.name,
  };
}

/**
 * Where a result line ends, in [lng, lat].
 * Province and state clicks have no line. A country line ends on the same
 * boundary point the kilometres use. A city line ends on that city.
 */
export function lineEndpoint(place: PlayPlace, guess: [number, number]): [number, number] | null {
  if (place.id.includes(":province:")) return null;
  if (place.id.includes(":country:")) {
    const border = approachPoint(place.name, guess);
    if (border) return [border[0], border[1]];
    if (distanceToCountryKm(place.name, guess) === 0) return null;
    return [place.coordinates[0], place.coordinates[1]];
  }
  return [place.coordinates[0], place.coordinates[1]];
}

function scoreRound(guesses: GuessWire[], place: PlayPlace): ScoredGuess[] {
  return guesses.map((guess) => scoreGuess(guess, place));
}

function upsertGuess(guesses: GuessWire[], guess: GuessWire): GuessWire[] {
  const index = guesses.findIndex((item) => item.playerId === guess.playerId);
  if (index === -1) return [...guesses, guess];
  const next = guesses.slice();
  next[index] = guess;
  return next;
}

function endsAt(state: EngineState, startedAt: number): number | null {
  if (state.mapDifficulty === "kids") return null;
  return startedAt + GUESS_MS;
}

function freshRound(state: EngineState, roundIndex: number, previewStartedAt: number): EngineState {
  const quiz = state.playFormat === "quiz";
  return {
    ...state,
    phase: quiz ? "QUIZ_QUESTION" : "GUESSING_ACTIVE",
    quizStep: 0,
    quizChoice: null,
    quizCorrect: null,
    roundIndex,
    previewStartedAt,
    guessingEndsAt: endsAt(state, previewStartedAt),
    resultStartedAt: null,
    pin: null,
    submitted: false,
    revealOpen: false,
    localGuess: null,
    locks: [],
    guesses: [],
  };
}

function toResult(state: EngineState, now: number, guesses: GuessWire[]): EngineState {
  const part = state.playFormat === "quiz" && state.quizStep === 3 ? 1 : 0;
  if (state.history.some((round) => round.roundIndex === state.roundIndex && (round.part ?? 0) === part)) return state;
  const cityId = state.cityIds[state.roundIndex];
  if (!cityId) return state;
  const city = getPlace(cityId);
  const scored = scoreRound(guesses, part === 1 ? { ...city, id: city.id.replace(":province:", ":capital:").replace(":country:", ":capital:") } : city);
  const label = state.playFormat === "quiz" && part === 1 ? (city.capitalName ?? city.name) : city.name;
  return {
    ...state,
    phase: "ROUND_RESULT",
    resultStartedAt: now,
    revealOpen: true,
    submitted: true,
    pin: null,
    guesses: scored,
    history: [...state.history, { roundIndex: state.roundIndex, cityId, guesses: scored, part, label }],
  };
}

function rosterOf(state: EngineState): string[] {
  if (state.rosterIds.length > 0) return state.rosterIds;
  return state.playerId ? [state.playerId] : [];
}

function allLocked(state: EngineState): boolean {
  const roster = rosterOf(state);
  if (roster.length < 2 && state.mode === "multi") return false;
  return roster.every((id) => state.locks.some((lock) => lock.playerId === id && lock.roundIndex === state.roundIndex));
}

function replaceHistoryRound(state: EngineState, guesses: GuessWire[]): EngineState {
  const cityId = state.cityIds[state.roundIndex];
  if (!cityId) return state;
  const scored = scoreRound(guesses, getPlace(cityId));
  const history = state.history.slice();
  const index = history.findIndex((round) => round.roundIndex === state.roundIndex);
  const record = { roundIndex: state.roundIndex, cityId, guesses: scored };
  if (index >= 0) history[index] = record;
  else history.push(record);
  return { ...state, history, guesses: scored, phase: "ROUND_RESULT", revealOpen: true };
}

function beginMatch(
  state: EngineState,
  seed: number,
  difficulty: MapDifficulty,
  region: string,
  placeMode: PlaceMode,
  previewStartedAt: number,
  rosterIds: string[],
  format: PlayFormat = "pin",
): EngineState {
  const idsMode = format === "quiz" ? quizPlaceMode(region) : placeMode;
  const cityIds = pickPlaceIds(seed, region, idsMode);
  if (cityIds.length === 0) return state;
  const localName = displayName(state.nickname, state.mode === "solo" ? "You" : state.isHost ? "Host" : "Guest");
  const next: EngineState = {
    ...state,
    mode: state.mode ?? "multi",
    mapDifficulty: difficulty,
    playFormat: format,
    region,
    placeMode,
    localName,
    seed,
    cityIds,
    rosterIds,
    history: [],
    quizPoints: 0,
    notice: null,
    connectionError: null,
  };
  return freshRound(next, 0, previewStartedAt);
}

export function reducer(state: EngineState, action: Action): EngineState {
  switch (action.type) {
    case "SET_DIFFICULTY":
      if (state.phase !== "LOBBY") return state;
      return { ...state, mapDifficulty: action.difficulty };
    case "SET_REGION":
      if (state.phase !== "LOBBY") return state;
      return { ...state, region: action.region };
    case "SET_PLACE_MODE":
      if (state.phase !== "LOBBY") return state;
      return { ...state, placeMode: action.placeMode };
    case "SET_QUESTION_CATEGORY":
      if (state.phase !== "LOBBY") return state;
      return { ...state, questionCategory: action.questionCategory };
    case "SET_LOCALE":
      if (state.phase !== "LOBBY") return state;
      return { ...state, locale: action.locale };
    case "SET_NICKNAME":
      if (state.phase !== "LOBBY" && state.phase !== "WAITING_PLAYER") return state;
      return { ...state, nickname: action.nickname.slice(0, 18) };
    case "SET_PLAYER":
      return { ...state, playerId: action.playerId };
    case "START_SOLO": {
      const next = beginMatch(
        { ...state, mode: "solo", isHost: true, roomCode: null },
        action.seed,
        state.mapDifficulty,
        state.region,
        state.placeMode,
        action.now,
        [state.playerId],
        action.format ?? "pin",
      );
      return { ...next, connection: "idle" };
    }
    case "QUIZ_CHOOSE":
      return answerQuiz(state, action.choice);
    case "QUIZ_TIMEOUT":
      return answerQuiz(state, null);
    case "QUIZ_ADVANCE": {
      if (state.phase !== "QUIZ_FEEDBACK" || state.playFormat !== "quiz") return state;
      if (state.quizStep === 0) {
        return {
          ...state,
          phase: "QUIZ_QUESTION",
          quizStep: 1,
          quizChoice: null,
          quizCorrect: null,
          submitted: false,
          guessingEndsAt: endsAt(state, action.now),
        };
      }
      return {
        ...state,
        phase: "GUESSING_ACTIVE",
        quizStep: 2,
        quizChoice: null,
        quizCorrect: null,
        submitted: false,
        pin: null,
        localGuess: null,
        guessingEndsAt: endsAt(state, action.now),
        resultStartedAt: null,
      };
    }
    case "QUIZ_PIN": {
      if (state.playFormat !== "quiz" || state.phase !== "GUESSING_ACTIVE" || state.submitted) return state;
      const timeRemaining =
        state.guessingEndsAt == null ? 8 : Math.max(0, Math.min(8, (state.guessingEndsAt - action.now) / 1000));
      const guess: GuessWire = {
        playerId: state.playerId,
        name: state.localName,
        roundIndex: state.roundIndex,
        coordinates: action.coordinates,
        confirmed: true,
        timeRemaining,
        place: action.place,
      };
      return toResult({ ...state, pin: action.coordinates }, action.now, [guess]);
    }
    case "QUIZ_MAP_NEXT": {
      if (state.playFormat !== "quiz" || state.phase !== "ROUND_RESULT" || state.quizStep !== 2) return state;
      return {
        ...state,
        phase: "GUESSING_ACTIVE",
        quizStep: 3,
        submitted: false,
        revealOpen: false,
        pin: null,
        localGuess: null,
        guesses: [],
        guessingEndsAt: endsAt(state, action.now),
        resultStartedAt: null,
      };
    }
    case "CREATE_ROOM":
      return {
        ...createInitialState(state.playerId),
        nickname: state.nickname,
        mapDifficulty: state.mapDifficulty,
        region: state.region,
        placeMode: state.placeMode,
        questionCategory: state.questionCategory,
        locale: state.locale,
        phase: "WAITING_PLAYER",
        mode: "multi",
        isHost: true,
        roomCode: action.code,
        localName: displayName(state.nickname, "Host"),
        connection: "connecting",
        rosterIds: [state.playerId],
      };
    case "JOIN_ROOM":
      return {
        ...createInitialState(state.playerId),
        nickname: state.nickname,
        mapDifficulty: state.mapDifficulty,
        region: state.region,
        placeMode: state.placeMode,
        questionCategory: state.questionCategory,
        locale: state.locale,
        phase: "WAITING_PLAYER",
        mode: "multi",
        isHost: false,
        roomCode: action.code,
        localName: displayName(state.nickname, "Guest"),
        connection: "connecting",
      };
    case "CONNECTION":
      return {
        ...state,
        connection: action.status,
        connectionError: action.error ?? null,
      };
    case "PRESENCE":
      return { ...state, players: action.players };
    case "MATCH_START":
      if (state.seed != null && state.phase !== "WAITING_PLAYER") return state;
      if (!action.rosterIds.includes(state.playerId)) {
        return { ...state, notice: "This room already has two players." };
      }
      return beginMatch(
        state,
        action.seed,
        action.difficulty,
        action.region,
        action.placeMode ?? "capitals",
        action.previewStartedAt,
        action.rosterIds,
      );
    case "SNAPSHOT": {
      const snap = action.snapshot;
      if (state.mode !== "multi") return state;
      if (!snap.rosterIds.includes(state.playerId)) {
        return { ...state, notice: "This room already has two players." };
      }
      if (state.seed != null && snap.roundIndex < state.roundIndex) return state;
      if (state.seed != null && state.roundIndex === snap.roundIndex) {
        const order: Phase[] = ["ROUND_PREVIEW", "GUESSING_ACTIVE", "ROUND_RESULT", "FINAL_RESULTS"];
        if (order.indexOf(state.phase) >= order.indexOf(snap.phase)) return state;
      }
      const localName = displayName(state.nickname, state.isHost ? "Host" : "Guest");
      const region = snap.region ?? "world";
      const placeMode = snap.placeMode ?? "capitals";
      return {
        ...state,
        localName,
        seed: snap.seed,
        mapDifficulty: snap.difficulty,
        region,
        placeMode,
        cityIds: pickPlaceIds(snap.seed, region, placeMode),
        rosterIds: snap.rosterIds,
        phase: snap.phase,
        roundIndex: snap.roundIndex,
        previewStartedAt: snap.previewStartedAt,
        guessingEndsAt: snap.guessingEndsAt,
        resultStartedAt: snap.resultStartedAt,
        history: snap.history,
        pin: null,
        submitted: false,
        revealOpen: snap.phase === "ROUND_RESULT" || snap.phase === "FINAL_RESULTS",
        localGuess: null,
        locks: [],
        guesses: [],
        notice: state.notice,
      };
    }
    case "BEGIN_GUESSING":
      if (state.phase !== "ROUND_PREVIEW" || state.previewStartedAt == null) return state;
      return {
        ...state,
        phase: "GUESSING_ACTIVE",
        guessingEndsAt: state.previewStartedAt + PREVIEW_MS + GUESS_MS,
        pin: null,
        submitted: false,
        revealOpen: false,
        localGuess: null,
        locks: state.locks.filter((lock) => lock.roundIndex === state.roundIndex),
        guesses: state.guesses.filter((guess) => guess.roundIndex === state.roundIndex),
      };
    case "PLACE_PIN":
      if (state.phase !== "GUESSING_ACTIVE" || state.submitted) return state;
      return { ...state, pin: action.coordinates };
    case "RESOLVE_SOLO":
      if (state.phase !== "GUESSING_ACTIVE") return state;
      return toResult(state, action.now, [action.guess]);
    case "LOCAL_LOCK":
      if (state.phase !== "GUESSING_ACTIVE" || state.submitted) return state;
      if (action.guess.roundIndex !== state.roundIndex) return state;
      return {
        ...state,
        submitted: true,
        localGuess: action.guess,
        locks: upsertLock(state.locks, {
          playerId: action.guess.playerId,
          name: action.guess.name,
          roundIndex: action.guess.roundIndex,
          timeRemaining: action.guess.timeRemaining,
        }),
      };
    case "REMOTE_LOCK":
      if (action.lock.roundIndex !== state.roundIndex) return state;
      if (action.lock.playerId === state.playerId) return state;
      if (state.phase !== "GUESSING_ACTIVE" && state.phase !== "ROUND_PREVIEW") return state;
      return { ...state, locks: upsertLock(state.locks, action.lock) };
    case "OPEN_REVEAL": {
      if (state.phase !== "GUESSING_ACTIVE") return state;
      if (action.guess.roundIndex !== state.roundIndex) return state;
      const guesses = upsertGuess(state.guesses, action.guess);
      const next = { ...state, revealOpen: true, submitted: true, localGuess: action.guess, guesses };
      if (readyToScore(next)) return toResult(next, action.now, next.guesses);
      return next;
    }
    case "REMOTE_REVEAL": {
      if (action.guess.roundIndex !== state.roundIndex) return state;
      if (action.guess.playerId === state.playerId) return state;
      if (state.phase === "ROUND_RESULT") {
        const guesses = upsertGuess(state.guesses, action.guess);
        return replaceHistoryRound(state, guesses);
      }
      if (state.phase !== "GUESSING_ACTIVE") return state;
      const guesses = upsertGuess(state.guesses, action.guess);
      const next = { ...state, guesses };
      if (next.revealOpen && readyToScore(next)) return toResult(next, action.now, guesses);
      return next;
    }
    case "FORCE_REVEAL": {
      if (state.phase !== "GUESSING_ACTIVE") return state;
      const guesses = state.guesses.slice();
      if (state.localGuess && !guesses.some((guess) => guess.playerId === state.playerId)) {
        guesses.push(state.localGuess);
      }
      for (const id of rosterOf(state)) {
        if (!guesses.some((guess) => guess.playerId === id)) {
          const player = state.players.find((item) => item.id === id);
          guesses.push({
            playerId: id,
            name: id === state.playerId ? state.localName : (player?.name ?? "Opponent"),
            roundIndex: state.roundIndex,
            coordinates: null,
            confirmed: false,
            timeRemaining: 0,
            place: null,
          });
        }
      }
      return toResult(state, action.now, guesses);
    }
    case "NEXT_ROUND":
      if (action.roundIndex >= state.cityIds.length) return { ...state, phase: "FINAL_RESULTS", pin: null };
      if (state.roundIndex === action.roundIndex && state.phase === "ROUND_PREVIEW") return state;
      if (action.roundIndex < state.roundIndex) return state;
      if (state.phase === "FINAL_RESULTS") return state;
      return freshRound(state, action.roundIndex, action.previewStartedAt);
    case "FINAL":
      return { ...state, phase: "FINAL_RESULTS", pin: null };
    case "OPPONENT_LEFT": {
      if (state.mode !== "multi") return state;
      if (state.phase === "LOBBY" || state.phase === "WAITING_PLAYER" || state.phase === "FINAL_RESULTS") {
        return state;
      }
      const next: EngineState = {
        ...state,
        mode: "solo",
        rosterIds: [state.playerId],
        notice: "Your opponent left. This match continues in solo.",
      };
      if (next.phase === "GUESSING_ACTIVE" && next.revealOpen) {
        return toResult(
          next,
          action.now,
          next.guesses.length ? next.guesses : next.localGuess ? [next.localGuess] : [],
        );
      }
      return next;
    }
    case "LEAVE":
      return {
        ...createInitialState(state.playerId),
        nickname: state.nickname,
        mapDifficulty: state.mapDifficulty,
        region: state.region,
        placeMode: state.placeMode,
        questionCategory: state.questionCategory,
        locale: state.locale,
      };
    case "PLAY_AGAIN":
      return {
        ...createInitialState(state.playerId),
        nickname: state.nickname,
        mapDifficulty: state.mapDifficulty,
        region: state.region,
        placeMode: state.placeMode,
        questionCategory: state.questionCategory,
        locale: state.locale,
      };
    case "CLEAR_NOTICE":
      return { ...state, notice: null };
    default:
      return state;
  }
}

const QUIZ_ANSWER_POINTS = 1000;

function answerQuiz(state: EngineState, choice: string | null): EngineState {
  if (state.phase !== "QUIZ_QUESTION" || state.playFormat !== "quiz" || state.seed == null) return state;
  if (state.quizStep !== 0 && state.quizStep !== 1) return state;
  const id = state.cityIds[state.roundIndex];
  if (!id) return state;
  const card = quizCard(state.seed, state.roundIndex, state.quizStep, getPlace(id), quizPool(state.region), state.locale, {
    category: state.questionCategory,
    difficulty: state.mapDifficulty,
    placeMode: state.placeMode,
    region: state.region,
  });
  const correct = choice != null && choice === card.correct;
  return {
    ...state,
    phase: "QUIZ_FEEDBACK",
    quizChoice: choice,
    quizCorrect: correct,
    quizPoints: state.quizPoints + (correct ? QUIZ_ANSWER_POINTS : 0),
    submitted: true,
  };
}

function upsertLock(locks: LockNotice[], lock: LockNotice): LockNotice[] {
  const index = locks.findIndex((item) => item.playerId === lock.playerId);
  if (index === -1) return [...locks, lock];
  const next = locks.slice();
  next[index] = lock;
  return next;
}

function readyToScore(state: EngineState): boolean {
  const roster = rosterOf(state);
  return roster.every((id) => state.guesses.some((guess) => guess.playerId === id));
}

export function currentCity(state: EngineState) {
  const id = state.cityIds[state.roundIndex];
  return id ? getPlace(id) : null;
}

export function totalFor(history: RoundRecord[], playerId: string): number {
  return history.reduce((sum, round) => {
    const guess = round.guesses.find((item) => item.playerId === playerId);
    return sum + (guess?.total ?? 0);
  }, 0);
}

export function matchTotal(state: EngineState): number {
  return totalFor(state.history, state.playerId) + state.quizPoints;
}

export function timeRemainingSeconds(state: EngineState, now: number): number {
  if (state.guessingEndsAt == null) return GUESS_MS / 1000;
  if (state.submitted && state.localGuess) return state.localGuess.timeRemaining;
  return Math.max(0, Math.min(GUESS_MS / 1000, (state.guessingEndsAt - now) / 1000));
}

export function buildMiss(state: EngineState): GuessWire {
  return {
    playerId: state.playerId,
    name: state.localName,
    roundIndex: state.roundIndex,
    coordinates: null,
    confirmed: false,
    timeRemaining: 0,
    place: null,
  };
}

export function buildLockGuess(state: EngineState, now: number, place: string | null = null): GuessWire | null {
  if (!state.pin) return null;
  const timeRemaining =
    state.guessingEndsAt == null
      ? state.mapDifficulty === "kids"
        ? 8
        : 0
      : Math.max(0, Math.min(GUESS_MS / 1000, (state.guessingEndsAt - now) / 1000));
  return {
    playerId: state.playerId,
    name: state.localName,
    roundIndex: state.roundIndex,
    coordinates: state.pin,
    confirmed: true,
    timeRemaining,
    place,
  };
}

export function publicSnapshot(state: EngineState): PublicSnapshot | null {
  if (state.seed == null) return null;
  return {
    seed: state.seed,
    difficulty: state.mapDifficulty,
    region: state.region,
    placeMode: state.placeMode,
    rosterIds: state.rosterIds,
    phase: state.phase,
    roundIndex: state.roundIndex,
    previewStartedAt: state.previewStartedAt,
    guessingEndsAt: state.guessingEndsAt,
    resultStartedAt: state.resultStartedAt,
    history: state.history,
  };
}

export function locksComplete(state: EngineState): boolean {
  return state.mode === "multi" && state.phase === "GUESSING_ACTIVE" && state.submitted && allLocked(state);
}
