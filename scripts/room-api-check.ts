import assert from "node:assert/strict";
import { centroid } from "@turf/turf";
import { getPlace } from "../data/catalog";
import { quizCard, quizPool } from "../data/quiz";
import type { PublicRoom } from "../lib/room-types";
import { provinceOutline } from "../lib/provinces";

const base = process.env.ROOM_API ?? "http://127.0.0.1:43123";

async function post(url: string, body: unknown): Promise<PublicRoom> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as PublicRoom & { error?: string };
  if (!response.ok) throw new Error(`${response.status} ${payload.error ?? response.statusText}`);
  return payload;
}

async function get(code: string): Promise<PublicRoom> {
  const response = await fetch(`${base}/api/rooms/${code}`, { cache: "no-store" });
  const payload = (await response.json()) as PublicRoom & { error?: string };
  if (!response.ok) throw new Error(`${response.status} ${payload.error ?? response.statusText}`);
  return payload;
}

function correctChoice(room: PublicRoom, step: 0 | 1): string {
  const id = room.cityIds[room.question?.roundIndex ?? 0];
  assert.ok(id);
  return quizCard(room.settings.seed, room.question?.roundIndex ?? 0, step, getPlace(id), quizPool(room.settings.region), room.settings.locale, {
    category: room.settings.questionCategory,
    difficulty: room.settings.mapDifficulty,
    placeMode: room.settings.placeMode,
    region: room.settings.region,
  }).correct;
}

async function answerBoth(room: PublicRoom, hostId: string, guestId: string, choiceFor: (id: string) => string | null, pinFor?: (id: string) => [number, number]) {
  const question = room.question;
  assert.ok(question);
  const send = (playerId: string) =>
    post(`${base}/api/rooms/${room.code}`, {
      action: "answer",
      playerId,
      roundIndex: question.roundIndex,
      step: question.step,
      choice: choiceFor(playerId),
      coordinates: pinFor ? pinFor(playerId) : null,
      place: pinFor ? "Test" : null,
    });
  await Promise.all([send(hostId), send(guestId)]);
  return get(room.code);
}

async function waitUntil(code: string, ready: (room: PublicRoom) => boolean): Promise<PublicRoom> {
  const started = Date.now();
  let latest = await get(code);
  while (!ready(latest)) {
    if (Date.now() - started > 20_000) throw new Error(`timed out at ${latest.status} ${latest.question?.step}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
    latest = await get(code);
  }
  return latest;
}

async function lobbyCheck() {
  const startsAt = Date.now() + 10 * 60 * 1000;
  const host = await post(`${base}/api/rooms`, {
    playerId: "host-browser",
    name: "Martijn",
    startsAt,
    region: "netherlands",
    questionCategory: "provinces",
    mapDifficulty: "normal",
    placeMode: "provinces",
    locale: "en",
  });
  assert.equal(host.code.length, 6);
  assert.equal(host.status, "lobby");
  assert.deepEqual(host.players.map((player) => player.name), ["Martijn"]);
  const guest = await post(`${base}/api/rooms/${host.code}`, { action: "join", playerId: "guest-browser", name: "Louisa" });
  assert.equal(guest.status, "lobby");
  assert.deepEqual(
    guest.players.map((player) => player.name),
    ["Martijn", "Louisa"],
  );
  const seenByHost = await get(host.code);
  assert.equal(seenByHost.startsAt, guest.startsAt);
  assert.deepEqual(
    seenByHost.players.map((player) => player.name),
    ["Martijn", "Louisa"],
  );
  const late = await post(`${base}/api/rooms/${host.code}`, {
    action: "settings",
    playerId: "host-browser",
    startsAt: Date.now() - 1000,
    name: "Martijn",
    region: "netherlands",
    questionCategory: "provinces",
    mapDifficulty: "normal",
    placeMode: "provinces",
    locale: "en",
  });
  assert.equal(late.status, "live");
  const guestView = await get(host.code);
  assert.deepEqual(guestView.cityIds, late.cityIds);
  assert.equal(guestView.question?.prompt, late.question?.prompt);
  assert.equal(guestView.recap.length, 0);
  assert.equal(JSON.stringify(guestView).includes('"choice"'), false);

  let room = guestView;
  const right = correctChoice(room, 0);
  room = await answerBoth(
    room,
    "host-browser",
    "guest-browser",
    (id) => (id === "host-browser" ? right : "not-the-answer"),
  );
  room = await waitUntil(host.code, (next) => (next.question?.step ?? 0) > 0 || next.status === "done");
  assert.equal(room.recap.length, 0, "multiple choice stays hidden");
  assert.equal(JSON.stringify(room).includes(right), false, "the correct choice is not in the live payload");
  assert.equal(room.scoreboard[0]?.playerId, "host-browser");
  assert.ok((room.scoreboard[0]?.score ?? 0) > (room.scoreboard[1]?.score ?? 0));

  const second = correctChoice(room, 1);
  room = await answerBoth(room, "host-browser", "guest-browser", () => second);
  room = await waitUntil(host.code, (next) => next.question?.step === 2);

  const city = getPlace(room.cityIds[room.question?.roundIndex ?? 0]);
  const outline = provinceOutline(city.name);
  assert.ok(outline, city.name);
  const inside = centroid(outline).geometry.coordinates as [number, number];
  const outside: [number, number] = [0, 0];
  room = await answerBoth(
    room,
    "host-browser",
    "guest-browser",
    () => null,
    (id) => (id === "host-browser" ? inside : outside),
  );
  room = await waitUntil(host.code, (next) => (next.question?.pins.length ?? 0) > 0);
  assert.equal(room.question?.pins.length, 2);
  assert.deepEqual(
    room.question?.pins.map((pin) => pin.name).sort(),
    ["Louisa", "Martijn"],
  );
  const hostPin = room.question?.pins.find((pin) => pin.playerId === "host-browser");
  const guestPin = room.question?.pins.find((pin) => pin.playerId === "guest-browser");
  assert.equal(hostPin?.correct, true);
  assert.equal(guestPin?.correct, false);
  assert.ok((hostPin?.points ?? 0) > 0 && (hostPin?.points ?? 0) < 2000, "a province click is right or wrong, not a distance score");
  assert.equal(guestPin?.points, 0);

  const locked = await fetch(`${base}/api/rooms/${host.code}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "join", playerId: "late-browser", name: "Late" }),
  });
  assert.equal(locked.status, 409);

  let guard = 0;
  while (room.status !== "done" && guard < 80) {
    guard += 1;
    const question = room.question;
    if (!question) break;
    if (question.revealUntil) {
      room = await waitUntil(host.code, (next) => next.question?.step !== question.step || next.question.roundIndex !== question.roundIndex || next.status === "done");
      continue;
    }
    const step = question.step;
    if (step === 0 || step === 1) {
      const choice = correctChoice(room, step);
      room = await answerBoth(room, "host-browser", "guest-browser", () => choice);
    } else {
      room = await answerBoth(room, "host-browser", "guest-browser", () => null, () => inside);
    }
    if (room.status !== "done" && room.question?.revealUntil) {
      room = await waitUntil(
        host.code,
        (next) => next.status === "done" || next.question?.roundIndex !== question.roundIndex || next.question?.step !== question.step,
      );
    }
  }
  assert.equal(room.status, "done");
  assert.ok(room.recap.length > 2);
  const firstChoice = room.recap.find((question) => question.kind === "choice");
  assert.ok(firstChoice);
  assert.equal(firstChoice.winnerName, "Martijn");
  assert.ok(firstChoice.answers.every((answer) => answer.name === "Martijn" || answer.name === "Louisa"));
  const province = room.recap.find((question) => question.binary);
  assert.ok(province);
  assert.equal(province.answers.find((answer) => answer.playerId === "guest-browser")?.correct, false);
  assert.equal(province.winnerName, "Martijn");
  console.log(`room ${host.code} recap ${room.recap.length} questions`);
}

lobbyCheck().then(
  () => {
    console.log("room api check passed");
  },
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
