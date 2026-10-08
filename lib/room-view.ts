import {
  createInitialState,
  type EngineState,
  type RoundRecord,
  type ScoredGuess,
} from "@/lib/game-engine";
import type { PublicRoom } from "@/lib/room-types";

export function viewFromRoom(
  room: PublicRoom,
  playerId: string,
  draft: { pin: [number, number] | null; submitted: boolean; choice: string | null },
): EngineState {
  const base = createInitialState(playerId);
  const question = room.question;
  const revealing = question?.revealUntil != null;
  const phase =
    room.status === "done"
      ? "FINAL_RESULTS"
      : room.status === "live" && question
        ? question.step <= 1
          ? "QUIZ_QUESTION"
          : revealing
            ? "ROUND_RESULT"
            : "GUESSING_ACTIVE"
        : "WAITING_PLAYER";
  const me = room.players.find((player) => player.id === playerId);
  const part = question?.step === 3 ? 1 : 0;
  const history: RoundRecord[] = [];
  if (question && revealing && question.step >= 2) {
    const cityId = room.cityIds[question.roundIndex];
    if (cityId) {
      const guesses: ScoredGuess[] = question.pins.map((pin) => ({
        playerId: pin.playerId,
        name: pin.name,
        roundIndex: question.roundIndex,
        coordinates: pin.coordinates,
        confirmed: pin.confirmed,
        timeRemaining: 0,
        place: pin.place,
        distanceKm: pin.distanceKm,
        distanceScore: 0,
        timeBonus: 0,
        total: pin.points,
      }));
      history.push({ roundIndex: question.roundIndex, cityId, guesses, part });
    }
  }
  return {
    ...base,
    phase,
    mode: "multi",
    mapDifficulty: room.settings.mapDifficulty,
    playFormat: "quiz",
    quizStep: question?.step ?? 0,
    quizChoice: draft.choice,
    region: room.settings.region,
    placeMode: room.settings.placeMode,
    questionCategory: room.settings.questionCategory,
    locale: room.settings.locale,
    nickname: me?.name ?? "",
    localName: me?.name ?? "You",
    playerId,
    roomCode: room.code,
    isHost: room.hostId === playerId,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      role: player.id === room.hostId ? "host" : "guest",
    })),
    seed: room.settings.seed,
    cityIds: room.cityIds,
    roundIndex: question?.roundIndex ?? 0,
    guessingEndsAt: question?.endsAt ?? null,
    pin: draft.pin,
    submitted: draft.submitted,
    revealOpen: Boolean(revealing),
    history,
    connection: "live",
  };
}
