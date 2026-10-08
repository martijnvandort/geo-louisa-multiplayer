import { connection } from "next/server";
import { createRoom, RoomError, type CreateInput } from "@/lib/server/rooms";

export async function POST(request: Request) {
  await connection();
  try {
    const body = (await request.json()) as CreateInput;
    const room = createRoom(body);
    return Response.json(room, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return fail(error);
  }
}

function fail(error: unknown) {
  if (error instanceof RoomError) {
    return Response.json({ error: error.message }, { status: error.status, headers: { "cache-control": "no-store" } });
  }
  return Response.json({ error: "Could not open that game." }, { status: 500, headers: { "cache-control": "no-store" } });
}
