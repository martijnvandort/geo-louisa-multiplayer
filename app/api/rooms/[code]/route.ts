import { connection } from "next/server";
import { answerRoom, joinRoom, readRoom, RoomError, updateRoom, type AnswerInput, type SettingsInput } from "@/lib/server/rooms";
import type { QuestionStep } from "@/lib/room-types";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(_request: Request, context: { params: Promise<{ code: string }> }) {
  await connection();
  try {
    const { code } = await context.params;
    return Response.json(readRoom(code), { headers: NO_STORE });
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ code: string }> }) {
  await connection();
  try {
    const { code } = await context.params;
    const body = (await request.json()) as {
      action?: string;
      playerId?: string;
      name?: string;
      startsAt?: number;
      region?: string;
      questionCategory?: SettingsInput["questionCategory"];
      mapDifficulty?: SettingsInput["mapDifficulty"];
      placeMode?: SettingsInput["placeMode"];
      locale?: SettingsInput["locale"];
      roundIndex?: number;
      step?: QuestionStep;
      choice?: string | null;
      coordinates?: [number, number] | null;
      place?: string | null;
    };
    const playerId = body.playerId ?? "";
    if (body.action === "join") {
      return Response.json(joinRoom(code, playerId, body.name ?? ""), { headers: NO_STORE });
    }
    if (body.action === "settings") {
      return Response.json(updateRoom(code, body as SettingsInput), { headers: NO_STORE });
    }
    if (body.action === "answer") {
      const answer: AnswerInput = {
        playerId,
        roundIndex: body.roundIndex ?? -1,
        step: body.step ?? 0,
        choice: body.choice,
        coordinates: body.coordinates,
        place: body.place,
      };
      return Response.json(answerRoom(code, answer), { headers: NO_STORE });
    }
    return Response.json({ error: "Unknown room action." }, { status: 400, headers: NO_STORE });
  } catch (error) {
    return fail(error);
  }
}

function fail(error: unknown) {
  if (error instanceof RoomError) {
    return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
  }
  return Response.json({ error: "Could not update that game." }, { status: 500, headers: NO_STORE });
}
