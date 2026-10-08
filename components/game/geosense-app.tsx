"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { MapStage, type MapArc, type MapPin } from "@/components/map-stage";
import { approachPoint, countryOutline } from "@/lib/country-shapes";
import { approachDivision, divisionAt } from "@/lib/provinces";
import { provinceOutline } from "@/lib/provinces";
import { FinalScreen, JoinPanel, LobbyScreen, MapTitle, PlayOverlay, QuestionBar, QuizCard, ScoreList, WaitingScreen } from "@/components/game/screens";
import { useRoom } from "@/components/game/use-room";
import { useSharedRoom, type HostSettings } from "@/components/game/use-shared-room";
import {
  buildLockGuess,
  buildMiss,
  createInitialState,
  currentCity,
  locksComplete,
  reducer,
} from "@/lib/game-engine";
import { playClick, playReveal, resumeAudio } from "@/lib/audio";
import { placesFor } from "@/data/catalog";
import { messages } from "@/lib/i18n";
import { COLOR, greatCircleSegments, PREVIEW_MS, RESULT_MS } from "@/lib/geo";
import { countryAt, loadCountries } from "@/lib/place";
import type { EngineState, GuessWire, PlayFormat } from "@/lib/game-engine";
import { createRoomCode, normalizeRoomCode, randomSeed } from "@/lib/room";
import { viewFromRoom } from "@/lib/room-view";

export function GeosenseApp({ playerId, inviteCode = null }: { playerId: string; inviteCode?: string | null }) {
  const [state, dispatch] = useReducer(reducer, playerId, createInitialState);
  const shared = useSharedRoom(playerId);
  const watchRoom = shared.watch;
  const updateRoom = shared.update;
  const [playMode, setPlayMode] = useState<"single" | "multi">("single");
  const [leftInvite, setLeftInvite] = useState(false);
  const roomInvite = leftInvite ? null : inviteCode;
  const [startsAt, setStartsAt] = useState(() => Date.now() + 10 * 60 * 1000);
  const [draftPin, setDraftPin] = useState<[number, number] | null>(null);
  const [draftChoice, setDraftChoice] = useState<string | null>(null);
  const [draftSent, setDraftSent] = useState(false);
  const stateRef = useRef(state);
  const sharedRef = useRef(shared);
  const sharedPlayRef = useRef(false);
  const draftSentRef = useRef(false);
  const { send } = useRoom(state, dispatch);
  const sendRef = useRef(send);
  useEffect(() => {
    stateRef.current = state;
    sendRef.current = send;
    sharedRef.current = shared;
    draftSentRef.current = draftSent;
  });
  useEffect(() => {
    void loadCountries();
  }, []);

  useEffect(() => {
    if (roomInvite) watchRoom(roomInvite);
  }, [roomInvite, watchRoom]);

  const inRoom = Boolean(shared.room?.players.some((player) => player.id === playerId));
  const guestLobby = Boolean(shared.room && inRoom && shared.room.hostId !== playerId && shared.room.status === "lobby");
  const sharedPlay = Boolean(shared.room && inRoom && (shared.room.status === "live" || shared.room.status === "done"));
  const questionKey = shared.room?.question ? `${shared.room.question.roundIndex}:${shared.room.question.step}:${shared.room.status}` : shared.room?.status ?? "";
  const [seenQuestion, setSeenQuestion] = useState(questionKey);
  if (seenQuestion !== questionKey) {
    setSeenQuestion(questionKey);
    setDraftPin(null);
    setDraftChoice(null);
    setDraftSent(false);
  }

  useEffect(() => {
    sharedPlayRef.current = sharedPlay;
  });

  const hosting = playMode === "multi" && shared.room?.hostId === playerId && shared.room.status === "lobby";
  const settingsKey = JSON.stringify({
    name: state.nickname,
    startsAt,
    region: state.region,
    questionCategory: state.questionCategory,
    mapDifficulty: state.mapDifficulty,
    placeMode: state.placeMode,
    locale: state.locale,
  });

  useEffect(() => {
    if (!hosting) return;
    const settings = JSON.parse(settingsKey) as HostSettings;
    const timer = window.setTimeout(() => {
      void updateRoom(settings).catch((error: Error) => {
        console.error(error);
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [hosting, settingsKey, updateRoom]);

  const startedRoom = useRef<string | null>(null);
  const revealSent = useRef(-1);
  const revealedSound = useRef(-1);
  const sawOpponent = useRef(false);

  const publishReveal = useCallback((guess: GuessWire) => {
    sendRef.current("reveal", { ...guess });
    dispatch({ type: "OPEN_REVEAL", guess, now: Date.now() });
  }, []);

  useEffect(() => {
    if (state.phase !== "ROUND_PREVIEW" || state.previewStartedAt == null) return;
    const delay = Math.max(0, state.previewStartedAt + PREVIEW_MS - Date.now());
    const timer = window.setTimeout(() => dispatch({ type: "BEGIN_GUESSING" }), delay);
    return () => window.clearTimeout(timer);
  }, [state.phase, state.previewStartedAt, state.roundIndex]);

  useEffect(() => {
    if (state.phase !== "GUESSING_ACTIVE" || state.guessingEndsAt == null) return;
    const delay = Math.max(0, state.guessingEndsAt - Date.now());
    const timer = window.setTimeout(() => {
      const current = stateRef.current;
      if (current.phase !== "GUESSING_ACTIVE") return;
      const guess =
        current.submitted && current.localGuess ? current.localGuess : buildMiss(current);
      if (current.mode === "solo") {
        dispatch({ type: "RESOLVE_SOLO", guess, now: Date.now() });
        return;
      }
      publishReveal(guess);
      window.setTimeout(() => dispatch({ type: "FORCE_REVEAL", now: Date.now() }), 800);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [publishReveal, state.guessingEndsAt, state.phase, state.roundIndex]);

  useEffect(() => {
    if (!locksComplete(state) || !state.localGuess) return;
    if (revealSent.current === state.roundIndex) return;
    revealSent.current = state.roundIndex;
    publishReveal(state.localGuess);
  }, [publishReveal, state]);

  useEffect(() => {
    if (state.phase !== "ROUND_RESULT" || state.resultStartedAt == null) return;
    const guestFallback = state.mode === "multi" && !state.isHost;
    const delay = Math.max(0, state.resultStartedAt + RESULT_MS + (guestFallback ? 2000 : 0) - Date.now());
    const timer = window.setTimeout(() => {
      const current = stateRef.current;
      if (current.phase !== "ROUND_RESULT") return;
      if (current.mode === "multi" && !current.isHost) {
        dispatch({
          type: "NEXT_ROUND",
          roundIndex: current.roundIndex + 1,
          previewStartedAt: Date.now(),
        });
        return;
      }
      // The world map stays on the country click. The capital pin returns when that country is shown on its own.
      if (current.playFormat === "quiz" && current.quizStep === 2 && current.region !== "world") {
        dispatch({ type: "QUIZ_MAP_NEXT", now: Date.now() });
        return;
      }
      if (current.roundIndex >= current.cityIds.length - 1) {
        if (current.mode === "multi") sendRef.current("match_end", { roundIndex: current.roundIndex });
        dispatch({ type: "FINAL" });
        return;
      }
      const previewStartedAt = Date.now();
      const roundIndex = current.roundIndex + 1;
      if (current.mode === "multi") sendRef.current("round_preview", { roundIndex, previewStartedAt });
      dispatch({ type: "NEXT_ROUND", roundIndex, previewStartedAt });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [state.isHost, state.mode, state.phase, state.quizStep, state.resultStartedAt, state.roundIndex]);

  useEffect(() => {
    if (state.phase !== "QUIZ_QUESTION" || state.guessingEndsAt == null) return;
    const delay = Math.max(0, state.guessingEndsAt - Date.now());
    const timer = window.setTimeout(() => {
      if (stateRef.current.phase !== "QUIZ_QUESTION") return;
      dispatch({ type: "QUIZ_TIMEOUT" });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [state.guessingEndsAt, state.phase, state.quizStep, state.roundIndex]);

  useEffect(() => {
    if (state.phase !== "QUIZ_FEEDBACK") return;
    const timer = window.setTimeout(() => dispatch({ type: "QUIZ_ADVANCE", now: Date.now() }), 1400);
    return () => window.clearTimeout(timer);
  }, [state.phase, state.quizStep, state.roundIndex]);

  useEffect(() => {
    if (state.phase !== "ROUND_RESULT") return;
    if (revealedSound.current === state.roundIndex) return;
    revealedSound.current = state.roundIndex;
    playReveal();
  }, [state.phase, state.roundIndex]);

  useEffect(() => {
    startedRoom.current = null;
    sawOpponent.current = false;
  }, [state.roomCode]);

  useEffect(() => {
    if (state.phase !== "WAITING_PLAYER" || !state.isHost || state.connection !== "live") return;
    if (state.seed != null || startedRoom.current === state.roomCode) return;
    const opponent = state.players.find((player) => player.id !== state.playerId);
    if (!opponent || !state.roomCode) return;
    startedRoom.current = state.roomCode;
    const seed = randomSeed();
    const previewStartedAt = Date.now();
    const rosterIds = [state.playerId, opponent.id];
    sendRef.current("match_start", {
      seed,
      difficulty: state.mapDifficulty,
      region: state.region,
      placeMode: state.placeMode,
      previewStartedAt,
      rosterIds,
    });
    dispatch({
      type: "MATCH_START",
      seed,
      difficulty: state.mapDifficulty,
      region: state.region,
      placeMode: state.placeMode,
      previewStartedAt,
      rosterIds,
    });
  }, [
    state.connection,
    state.isHost,
    state.mapDifficulty,
    state.placeMode,
    state.region,
    state.phase,
    state.playerId,
    state.players,
    state.roomCode,
    state.seed,
  ]);

  useEffect(() => {
    if (state.mode !== "multi") return;
    if (state.phase === "LOBBY" || state.phase === "WAITING_PLAYER" || state.phase === "FINAL_RESULTS") return;
    const opponentHere = state.players.some(
      (player) => player.id !== state.playerId && state.rosterIds.includes(player.id),
    );
    if (opponentHere) {
      sawOpponent.current = true;
      return;
    }
    if (!sawOpponent.current || state.connection !== "live") return;
    const timer = window.setTimeout(() => {
      const current = stateRef.current;
      const stillGone = !current.players.some(
        (player) => player.id !== current.playerId && current.rosterIds.includes(player.id),
      );
      if (stillGone && current.mode === "multi") dispatch({ type: "OPPONENT_LEFT", now: Date.now() });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [state.connection, state.mode, state.phase, state.playerId, state.players, state.rosterIds]);

  const locking = useRef(false);
  useEffect(() => {
    if (state.phase !== "GUESSING_ACTIVE") locking.current = false;
  }, [state.phase, state.quizStep, state.roundIndex]);

  const onPlace = useCallback((coordinates: [number, number]) => {
    if (sharedPlayRef.current) {
      const live = sharedRef.current.room;
      const question = live?.question;
      if (!live || !question || question.step < 2 || question.revealUntil || draftSentRef.current) return;
      resumeAudio();
      playClick();
      setDraftPin(coordinates);
      const region = live.settings.region;
      const locate =
        region === "netherlands" || region === "united-states"
          ? Promise.resolve(divisionAt(region, coordinates))
          : countryAt(coordinates);
      void locate.then((place) => {
        const latest = sharedRef.current.room;
        if (!latest?.question || latest.question.revealUntil || draftSentRef.current) return;
        if (latest.question.roundIndex !== question.roundIndex || latest.question.step !== question.step) return;
        draftSentRef.current = true;
        setDraftSent(true);
        void sharedRef.current
          .answer({
            roundIndex: question.roundIndex,
            step: question.step,
            coordinates,
            place,
          })
          .catch(() => {
            draftSentRef.current = false;
            setDraftSent(false);
          });
      });
      return;
    }
    const current = stateRef.current;
    if (current.phase !== "GUESSING_ACTIVE" || current.submitted || locking.current) return;
    locking.current = true;
    resumeAudio();
    playClick();
    const now = Date.now();
    const locate = current.region === "netherlands" || current.region === "united-states"
      ? Promise.resolve(divisionAt(current.region, coordinates))
      : countryAt(coordinates);
    void locate.then((place) => {
      const latest = stateRef.current;
      if (latest.phase !== "GUESSING_ACTIVE" || latest.submitted) return;
      if (latest.playFormat === "quiz") {
        dispatch({ type: "QUIZ_PIN", coordinates, now, place });
        return;
      }
      const guess = buildLockGuess({ ...latest, pin: coordinates }, now, place);
      if (!guess) return;
      if (latest.mode === "solo") {
        dispatch({ type: "RESOLVE_SOLO", guess, now });
        return;
      }
      sendRef.current("locked", {
        playerId: guess.playerId,
        name: guess.name,
        roundIndex: guess.roundIndex,
        timeRemaining: guess.timeRemaining,
      });
      dispatch({ type: "LOCAL_LOCK", guess });
    });
  }, []);

  const startMatch = useCallback((format: PlayFormat) => {
    resumeAudio();
    dispatch({ type: "START_SOLO", now: Date.now(), seed: randomSeed(), format });
  }, []);

  const view =
    sharedPlay && shared.room
      ? viewFromRoom(shared.room, playerId, { pin: draftPin, submitted: draftSent, choice: draftChoice })
      : state;
  const presentation = useMemo(() => presentationFrom(view), [view]);
  const [settledRegion, setSettledRegion] = useState(state.region);
  if (state.phase !== "LOBBY" && settledRegion !== state.region) setSettledRegion(state.region);
  const mapRegion = sharedPlay ? view.region : state.phase === "LOBBY" ? settledRegion : state.region;
  const showJoin = (guestLobby || (Boolean(roomInvite) && !inRoom)) && !sharedPlay;

  const playing =
    view.phase === "ROUND_PREVIEW" || view.phase === "GUESSING_ACTIVE" || view.phase === "ROUND_RESULT";
  const quizzing = view.phase === "QUIZ_QUESTION" || view.phase === "QUIZ_FEEDBACK";
  const inRound = playing || quizzing;
  const text = messages(view.locale);

  function leaveShared() {
    shared.leaveLocal();
    setPlayMode("single");
    setLeftInvite(true);
    window.history.replaceState(null, "", window.location.pathname);
  }

  function leaveRound() {
    if (sharedPlay) leaveShared();
    dispatch({ type: "LEAVE" });
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#e2f6fe] text-[#2f4a52]">
      <div
        className={`absolute top-0 left-0 right-0 ${inRound ? "xl:right-36" : ""} ${
          playing
            ? "bottom-[calc(3.5rem+env(safe-area-inset-bottom))]"
            : quizzing
              ? "max-xl:bottom-[calc(3.5rem+env(safe-area-inset-bottom))]"
              : "bottom-0"
        }`}
      >
      <MapStage
        difficulty={view.mapDifficulty}
        region={mapRegion}
        interactive={view.phase === "GUESSING_ACTIVE" && !view.submitted}
        pins={presentation.pins}
        arcs={presentation.arcs}
        highlight={presentation.highlight}
        onPlace={onPlace}
        zoomLabel={text.zoomIn}
      />
      <MapTitle region={view.region} locale={view.locale} />
      {view.phase === "LOBBY" && !showJoin ? (
        <LobbyScreen
          state={state}
          onDifficulty={(difficulty) => dispatch({ type: "SET_DIFFICULTY", difficulty })}
          onRegion={(region) => dispatch({ type: "SET_REGION", region })}
          onPlaceMode={(placeMode) => dispatch({ type: "SET_PLACE_MODE", placeMode })}
          onQuestionCategory={(questionCategory) => dispatch({ type: "SET_QUESTION_CATEGORY", questionCategory })}
          onNickname={(nickname) => dispatch({ type: "SET_NICKNAME", nickname })}
          onLocale={(locale) => dispatch({ type: "SET_LOCALE", locale })}
          onPlay={startMatch}
          onCreate={() => {
            resumeAudio();
            dispatch({ type: "CREATE_ROOM", code: createRoomCode() });
          }}
          onJoin={(code) => {
            resumeAudio();
            dispatch({ type: "JOIN_ROOM", code });
          }}
          playMode={playMode}
          onPlayMode={(mode) => {
            setPlayMode(mode);
            if (mode !== "multi") return;
            if (shared.room?.hostId === playerId && shared.room.status === "lobby") return;
            void shared.create({
              name: state.nickname || "Host",
              startsAt,
              region: state.region,
              questionCategory: state.questionCategory,
              mapDifficulty: state.mapDifficulty,
              placeMode: state.placeMode,
              locale: state.locale,
            });
          }}
          startsAt={startsAt}
          onStartsAt={setStartsAt}
          sharedRoom={playMode === "multi" ? shared.room : null}
          sharedError={shared.error}
          onJoinCode={(code, name) => {
            void shared.join(normalizeRoomCode(code), name);
          }}
        />
      ) : null}
      {showJoin ? (
        <JoinPanel
          locale={shared.room?.settings.locale ?? state.locale}
          code={shared.room?.code ?? roomInvite ?? ""}
          joined={guestLobby}
          players={shared.room?.players ?? []}
          startsAt={shared.room?.startsAt ?? 0}
          error={shared.error}
          onJoin={(name) => {
            const code = roomInvite ?? shared.room?.code;
            if (!code) return;
            void shared.join(code, name);
          }}
        />
      ) : null}
      {view.phase === "WAITING_PLAYER" && !showJoin ? (
        <WaitingScreen state={view} onLeave={() => dispatch({ type: "LEAVE" })} />
      ) : null}
      {quizzing ? (
        <QuizCard
          state={view}
          onChoose={(choice) => {
            const question = shared.room?.question;
            if (sharedPlay && question && question.step <= 1) {
              if (draftSent) return;
              setDraftChoice(choice);
              setDraftSent(true);
              draftSentRef.current = true;
              void shared.answer({ roundIndex: question.roundIndex, step: question.step, choice }).catch(() => {
                draftSentRef.current = false;
                setDraftSent(false);
              });
              return;
            }
            dispatch({ type: "QUIZ_CHOOSE", choice });
          }}
        />
      ) : null}
      {view.phase === "FINAL_RESULTS" ? (
        <FinalScreen
          state={view}
          recap={shared.room?.status === "done" ? shared.room.recap : null}
          onAgain={() => {
            leaveShared();
            dispatch({ type: "PLAY_AGAIN" });
          }}
        />
      ) : null}
      </div>
      {sharedPlay && shared.room?.status === "live" ? <ScoreList rows={shared.room.scoreboard} /> : null}
      {playing ? <PlayOverlay state={view} onEnd={leaveRound} /> : null}
      {quizzing ? <QuestionBar state={view} onEnd={leaveRound} /> : null}
      {inRound ? (
        <div className="pointer-events-none absolute inset-y-0 right-0 z-30 hidden w-36 items-center px-3 xl:flex">
          <button
            type="button"
            onClick={leaveRound}
            className="pointer-events-auto h-10 w-full border border-[#2A150C] bg-[#FAD5B3] text-sm font-medium text-[#2A150C]"
          >
            {text.endGame}
          </button>
        </div>
      ) : null}
    </main>
  );
}

function presentationFrom(state: EngineState): { pins: MapPin[]; arcs: MapArc[]; highlight: GeoJSON.Feature | null } {
  const city = currentCity(state);
  const pins: MapPin[] = [];
  const arcs: MapArc[] = [];
  const part = state.playFormat === "quiz" && state.quizStep === 3 ? 1 : 0;
  const areaRound =
    (state.playFormat === "quiz" && state.quizStep === 2) ||
    (state.playFormat !== "quiz" && (state.placeMode === "provinces" || state.placeMode === "countries"));
  const result = state.history.find((round) => round.roundIndex === state.roundIndex && (round.part ?? 0) === part);
  const mine = result?.guesses.find((guess) => guess.playerId === state.playerId);
  const outline =
    state.phase === "ROUND_RESULT" && areaRound && city
      ? city.id.includes(":country:")
        ? countryOutline(city.name)
        : provinceOutline(city.name)
      : null;
  const highlight = outline
    ? { ...outline, properties: { ...outline.properties, correct: mine?.distanceKm === 0 } }
    : null;

  if (state.phase === "GUESSING_ACTIVE" && state.pin) {
    pins.push({ id: "player", coordinates: state.pin, color: COLOR.player });
  }

  if (state.phase === "FINAL_RESULTS") {
    for (const place of placesFor(state.region, state.placeMode)) {
      pins.push({
        id: `capital-${place.id}`,
        coordinates: place.coordinates,
        color: COLOR.capital,
        capital: true,
      });
    }
    for (const round of state.history) {
      for (const guess of round.guesses) {
        if (!guess.confirmed || !guess.coordinates) continue;
        const mine = guess.playerId === state.playerId;
        pins.push({
          id: `guess-${guess.playerId}-${round.roundIndex}-${round.part ?? 0}`,
          coordinates: guess.coordinates,
          color: mine ? COLOR.player : COLOR.opponent,
        });
      }
    }
  }

  if (state.phase === "ROUND_RESULT" && city) {
    const record = result;
    if (!areaRound) {
      pins.push({ id: "target", coordinates: city.coordinates, color: COLOR.target, beacon: true });
    }
    for (const guess of record?.guesses ?? []) {
      if (!guess.confirmed || !guess.coordinates) continue;
      const mine = guess.playerId === state.playerId;
        pins.push({
          id: mine ? "player" : `opponent-${guess.playerId}`,
          coordinates: guess.coordinates,
          color: mine ? COLOR.player : COLOR.opponent,
          label: state.mode === "multi" ? guess.name : undefined,
        });
      const divisionArea = areaRound && city.id.includes(":province:");
      if (divisionArea) continue;
      const area = city.id.includes(":country:") || city.id.includes(":province:");
      const borderPoint =
        area && (guess.distanceKm ?? 0) > 0
          ? city.id.includes(":province:")
            ? approachDivision(city.name, guess.coordinates)
            : approachPoint(city.name, guess.coordinates)
          : null;
      arcs.push({
        id: `${guess.playerId}-${state.roundIndex}`,
        color: mine ? COLOR.player : COLOR.opponent,
        segments: greatCircleSegments(guess.coordinates, borderPoint ?? city.coordinates),
      });
    }
  }

  return { pins, arcs, highlight };
}
