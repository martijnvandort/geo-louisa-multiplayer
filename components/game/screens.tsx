"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { ChevronDown, Copy, Globe, Trophy, Volume2, VolumeX, X } from "lucide-react";
import { placeCount, quizPlaceMode, getPlace, type PlaceMode } from "@/data/catalog";
import { QUESTION_CATEGORY_LABEL, categoryForMap, questionCategoriesFor, type QuestionCategory } from "@/data/question-categories";
import { quizCard, quizPool } from "@/data/quiz";
import { useNow } from "@/components/game/count-up";
import { Button } from "@/components/ui/button";
import type { EngineState, MapDifficulty, PlayFormat } from "@/lib/game-engine";
import { matchTotal } from "@/lib/game-engine";
import type { PublicRoom, RecapQuestion } from "@/lib/room-types";
import { fill, localPlaceName, LOCALE_IDS, messages, type LocaleId, type Messages } from "@/lib/i18n";
import { formatKm, formatScore, GUESS_MS } from "@/lib/geo";
import { placeNote } from "@/lib/place";
import { isMuted, playTick, setMuted } from "@/lib/audio";

const glass = "rounded-2xl border border-[#2A150C] bg-[#E2ECC0] text-[#2A150C] shadow-[0_10px_28px_rgba(42,21,12,0.12)]";

function MuteButton() {
  const [muted, setMutedState] = useState(false);
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={muted ? "Unmute cues" : "Mute cues"}
      onClick={() => {
        const next = !isMuted();
        setMuted(next);
        setMutedState(next);
      }}
    >
      {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
    </Button>
  );
}

const MAP_LABEL: Record<string, keyof Messages> = {
  world: "theWorld",
  eu: "eu",
  "middle-east": "middleEast",
  "north-america": "northAmerica",
  "central-america": "centralAmerica",
  "south-america": "southAmerica",
  africa: "africa",
  asia: "asia",
  oceania: "oceania",
  netherlands: "netherlands",
  "united-states": "unitedStates",
};

const WELCOME = "Welcome to Louisa's World of knowledge, culture and fun";
const face = "[font-family:var(--font-inter),Inter,sans-serif]";

export function MapTitle({ region, locale }: { region: string; locale: LocaleId }) {
  const text = messages(locale);
  const key = MAP_LABEL[region];
  const title = key ? text[key] : region;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center px-3">
      <div
        className={`max-w-full rounded-b-xl border border-t-0 border-[#d4c8b8] bg-[#f6f1ea] px-4 pt-[max(0.35rem,env(safe-area-inset-top))] pb-1.5 text-center shadow-sm ${face}`}
      >
        <p className="text-[12.5px] font-semibold leading-tight text-[#333333] sm:text-sm">{WELCOME}</p>
        <p className="mt-0.5 text-xs font-medium leading-tight text-[#6e655c]">{title}</p>
      </div>
    </div>
  );
}

const REGIONS: { id: string; label: keyof Messages }[] = [
  { id: "world", label: "theWorld" },
  { id: "eu", label: "eu" },
  { id: "middle-east", label: "middleEast" },
  { id: "north-america", label: "northAmerica" },
  { id: "central-america", label: "centralAmerica" },
  { id: "south-america", label: "southAmerica" },
  { id: "africa", label: "africa" },
  { id: "asia", label: "asia" },
  { id: "oceania", label: "oceania" },
];

const COUNTRIES: { id: string; label: keyof Messages }[] = [
  { id: "netherlands", label: "netherlands" },
  { id: "united-states", label: "unitedStates" },
];

const uiFace = "[font-family:var(--font-ui),DM_Sans,sans-serif]";
const displayFace = "[font-family:var(--font-display),Cormorant_Garamond,serif]";
const questionType = `min-w-0 text-2xl leading-[1.15] font-normal tracking-[-0.005em] text-balance ${displayFace}`;
const ink = "text-[#2A150C]";
const fieldMetric = `box-border h-[34px] w-[152px] shrink-0 appearance-none border border-[#2A150C] py-0 pr-7 pl-3 text-right text-[15px] font-normal leading-[34px] outline-none ${displayFace}`;
const fieldClass = `${fieldMetric} text-[#2A150C]`;
const fieldLocked = `${fieldMetric} text-[#7A4E28]`;

const LEVELS: { id: MapDifficulty; label: "kids" | "adults" | "smartAdults" }[] = [
  { id: "kids", label: "kids" },
  { id: "normal", label: "adults" },
  { id: "hard", label: "smartAdults" },
];

function placeModeFor(category: QuestionCategory, region: string): PlaceMode {
  if (category === "provinces" || category === "states") return "provinces";
  if (category === "province-capitals") return "division-capitals";
  if (category === "state-capitals" || category === "capitals") return "capitals";
  return quizPlaceMode(region);
}

export function LobbyScreen({
  state,
  onDifficulty,
  onRegion,
  onPlaceMode,
  onQuestionCategory,
  onNickname,
  onLocale,
  onPlay,
  playMode,
  onPlayMode,
  startsAt,
  onStartsAt,
  sharedRoom,
  sharedError,
  onJoinCode,
}: {
  state: EngineState;
  onDifficulty: (difficulty: MapDifficulty) => void;
  onRegion: (region: string) => void;
  onPlaceMode: (placeMode: PlaceMode) => void;
  onQuestionCategory: (questionCategory: QuestionCategory) => void;
  onNickname: (nickname: string) => void;
  onLocale: (locale: LocaleId) => void;
  onPlay: (format: PlayFormat) => void;
  onCreate: () => void;
  onJoin: (code: string) => void;
  playMode: "single" | "multi";
  onPlayMode: (mode: "single" | "multi") => void;
  startsAt: number;
  onStartsAt: (value: number) => void;
  sharedRoom: PublicRoom | null;
  sharedError: string | null;
  onJoinCode: (code: string, name: string) => void;
}) {
  const text = messages(state.locale);
  const quizAvailable = placeCount(state.region, quizPlaceMode(state.region)) > 0;
  const locale = state.locale === "nl" ? "nl" : "en";
  const byName = (a: { label: keyof Messages }, b: { label: keyof Messages }) =>
    text[a.label].localeCompare(text[b.label], locale);
  const regions = REGIONS.slice().sort(byName);
  const countries = COUNTRIES.slice().sort(byName);
  const [step1Done, setStep1Done] = useState(false);
  const [categoryChosen, setCategoryChosen] = useState(false);
  const [levelChosen, setLevelChosen] = useState(false);
  const regionValue = REGIONS.some((choice) => choice.id === state.region) ? state.region : "";
  const countryValue = COUNTRIES.some((choice) => choice.id === state.region) ? state.region : "";
  const category = categoryForMap(state.questionCategory, state.region);
  const categories = questionCategoriesFor(state.region);
  const laterSteps = step1Done;

  useEffect(() => {
    if (category !== state.questionCategory) onQuestionCategory(category);
    const mode = placeModeFor(category, state.region);
    if (mode !== state.placeMode) onPlaceMode(mode);
  }, [category, onPlaceMode, onQuestionCategory, state.placeMode, state.questionCategory, state.region]);

  function chooseCategory(next: QuestionCategory) {
    setCategoryChosen(true);
    onQuestionCategory(next);
    const mode = placeModeFor(next, state.region);
    if (mode !== state.placeMode) onPlaceMode(mode);
  }

  function chooseMap(id: string) {
    setStep1Done(true);
    onRegion(id);
    const next = categoryForMap(state.questionCategory, id);
    if (next !== state.questionCategory) onQuestionCategory(next);
    const mode = placeModeFor(next, id);
    if (mode !== state.placeMode) onPlaceMode(mode);
  }

  const levelNote =
    state.mapDifficulty === "kids"
      ? text.levelNoteEasy
      : state.mapDifficulty === "hard"
        ? text.levelNoteHard
        : text.levelNoteMedium;

  return (
    <div className={panelClass}>
      <SheetHandle />
      <header className="flex h-12 shrink-0 items-center justify-end border-b-[0.5px] border-[#2A150C] px-4">
        <label className={ink}>
          <span className="sr-only">{text.language}</span>
          <span className="flex items-center gap-1.5 border-[0.5px] border-[#2A150C] bg-[#E2ECC0] px-2 py-1 text-xs">
            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
            <select
              aria-label={text.language}
              value={state.locale}
              onChange={(event) => onLocale(event.target.value as LocaleId)}
              className="appearance-none bg-transparent pr-3 focus:outline-none"
            >
              {LOCALE_IDS.map((id) => (
                <option key={id} value={id}>
                  {id.toUpperCase()}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none -ml-3 h-3 w-3 text-[#2A150C]" aria-hidden="true" />
          </span>
        </label>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        <div className="space-y-2">
          <h1 className={`${questionType} flex items-baseline gap-2 ${ink}`}>
            <span className="shrink-0 tabular-nums">1</span>
            <span>{text.chooseRegion}</span>
          </h1>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label={text.chooseRegion}>
            {regions.map((choice) => {
              const selected = step1Done && regionValue === choice.id;
              return (
                <button
                  key={choice.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => chooseMap(choice.id)}
                  className={`box-border h-[34px] shrink-0 whitespace-nowrap border border-[#2A150C] px-3 text-xs font-normal text-[#2A150C] ${
                    selected ? "bg-[#FAD5B3]" : "bg-[#FBF6D2]"
                  }`}
                >
                  {text[choice.label]}
                </button>
              );
            })}
            <span className="relative shrink-0">
              <select
                aria-label={text.orCountry}
                className={`box-border h-[34px] w-[152px] appearance-none border border-[#2A150C] py-0 pr-7 pl-3 text-xs font-normal text-[#2A150C] outline-none ${
                  step1Done && countryValue !== "" ? "bg-[#FAD5B3]" : "bg-[#FBF6D2]"
                }`}
                value={step1Done ? countryValue : ""}
                onChange={(event) => {
                  if (event.target.value) chooseMap(event.target.value);
                }}
              >
                <option value="">{text.orCountry}</option>
                {countries.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {text[choice.label]}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-[#2A150C]" />
            </span>
          </div>
        </div>
        <div aria-disabled={laterSteps ? undefined : true}>
          <FieldRow label={text.whatFind} step="2" locked={!laterSteps}>
            <select
              aria-label={text.whatFind}
              className={`${laterSteps ? fieldClass : fieldLocked} ${categoryChosen ? "bg-[#FAD5B3]" : "bg-[#FBF6D2]"}`}
              value={category}
              disabled={!laterSteps}
              onChange={(event) => chooseCategory(event.target.value as QuestionCategory)}
            >
              {categories.map((choice) => (
                <option key={choice} value={choice}>
                  {text[QUESTION_CATEGORY_LABEL[choice]]}
                </option>
              ))}
            </select>
          </FieldRow>
        </div>
        <div className="space-y-1.5" aria-disabled={laterSteps ? undefined : true}>
          <FieldRow label={text.whatLevel} step="3" locked={!laterSteps}>
            <select
              aria-label={text.whatLevel}
              className={`${laterSteps ? fieldClass : fieldLocked} ${levelChosen ? "bg-[#FAD5B3]" : "bg-[#FBF6D2]"}`}
              value={state.mapDifficulty}
              disabled={!laterSteps}
              onChange={(event) => {
                setLevelChosen(true);
                onDifficulty(event.target.value as MapDifficulty);
              }}
            >
              {LEVELS.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {text[choice.label]}
                </option>
              ))}
            </select>
          </FieldRow>
          <p className={`h-4 text-right text-xs leading-4 ${laterSteps ? "text-[#5C3014]" : "text-[#7A4E28]"}`}>{levelNote}</p>
        </div>
        <PlayModeStep
          locale={state.locale}
          playMode={playMode}
          onPlayMode={onPlayMode}
          startsAt={startsAt}
          onStartsAt={onStartsAt}
          room={sharedRoom}
          error={sharedError}
          onNickname={onNickname}
          onJoinCode={onJoinCode}
        />
      </div>
      <footer className="flex shrink-0 items-center justify-end border-t-[0.5px] border-[#2A150C] px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <button
          type="button"
          className="h-9 w-full border border-[#2A150C] bg-[#FAD5B3] px-4 text-sm font-medium text-[#2A150C] disabled:opacity-40 md:w-auto md:min-w-[104px]"
          disabled={!step1Done || !quizAvailable || playMode === "multi"}
          onClick={() => onPlay("quiz")}
        >
          {text.play}
        </button>
      </footer>
    </div>
  );
}

function FieldRow({
  label,
  step,
  locked = false,
  children,
}: {
  label: string;
  step: string;
  locked?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h2 className={`${questionType} flex items-baseline gap-2 ${locked ? "text-[#7A4E28]" : ink}`}>
        <span className="shrink-0 tabular-nums">{step}</span>
        <span>{label}</span>
      </h2>
      <span className="relative">
        {children}
        <ChevronDown
          className={`pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 ${locked ? "text-[#7A4E28]" : "text-[#2A150C]"}`}
        />
      </span>
    </div>
  );
}

const panelClass = `pointer-events-auto absolute inset-x-0 bottom-0 z-20 flex h-[58dvh] max-h-[70dvh] flex-col rounded-t-2xl border-t border-[#2A150C] bg-[#E2ECC0] text-[#2A150C] shadow-[0_-10px_28px_rgba(42,21,12,0.12)] md:inset-y-0 md:right-auto md:left-0 md:h-dvh md:max-h-none md:w-[min(480px,calc(100%-48px))] md:rounded-none md:border-t-0 md:shadow-none ${uiFace}`;

function SheetHandle() {
  return (
    <div className="flex shrink-0 justify-center pt-2 md:hidden" aria-hidden="true">
      <span className="h-1 w-10 rounded-full bg-[#2A150C]" />
    </div>
  );
}

function EndGameIcon({ label, onEnd }: { label: string; onEnd: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onEnd}
      className="grid h-9 w-9 shrink-0 place-items-center border border-[#2A150C] bg-[#FAD5B3] text-[#2A150C]"
    >
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

function localInputValue(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

export function CountdownLine({ startsAt, template }: { startsAt: number; template: string }) {
  const now = useNow(startsAt > 0);
  const remaining = Math.max(0, startsAt - now);
  return <p className="font-mono text-lg tabular-nums text-[#2A150C]">{fill(template, { time: formatRemaining(remaining) })}</p>;
}

function PlayerNames({ label, players }: { label: string; players: { id: string; name: string }[] }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-[#5C3014]">{label}</p>
      {players.length === 0 ? (
        <p className="text-sm text-[#5C3014]">—</p>
      ) : (
        <ul className="space-y-1">
          {players.map((player) => (
            <li key={player.id} className="border border-[#2A150C] bg-[#FBF6D2] px-2 py-1 text-sm text-[#2A150C]">
              {player.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PlayModeStep({
  locale,
  playMode,
  onPlayMode,
  startsAt,
  onStartsAt,
  room,
  error,
  onNickname,
  onJoinCode,
}: {
  locale: LocaleId;
  playMode: "single" | "multi";
  onPlayMode: (mode: "single" | "multi") => void;
  startsAt: number;
  onStartsAt: (value: number) => void;
  room: PublicRoom | null;
  error: string | null;
  onNickname: (nickname: string) => void;
  onJoinCode: (code: string, name: string) => void;
}) {
  const text = messages(locale);
  const [hostName, setHostName] = useState("");
  const [joinName, setJoinName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setOrigin(window.location.origin), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const joinUrl = origin && room ? `${origin}/?room=${room.code}` : "";
  const choiceClass = (selected: boolean) =>
    `box-border h-[34px] shrink-0 border border-[#2A150C] px-3 text-xs font-normal text-[#2A150C] ${selected ? "bg-[#FAD5B3]" : "bg-[#FBF6D2]"}`;

  return (
    <div className="space-y-2">
      <h2 className={`${questionType} flex items-baseline gap-2 ${ink}`}>
        <span className="shrink-0 tabular-nums">4</span>
        <span>{text.howPlay}</span>
      </h2>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={text.howPlay}>
        <button type="button" aria-pressed={playMode === "single"} className={choiceClass(playMode === "single")} onClick={() => onPlayMode("single")}>
          {text.singlePlayer}
        </button>
        <button type="button" aria-pressed={playMode === "multi"} className={choiceClass(playMode === "multi")} onClick={() => onPlayMode("multi")}>
          {text.multiplayer}
        </button>
      </div>
      {playMode === "single" ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!joinName.trim() || joinCode.trim().length < 6) return;
            onJoinCode(joinCode, joinName);
          }}
        >
          <input
            aria-label={text.whatName}
            value={joinName}
            onChange={(event) => setJoinName(event.target.value.slice(0, 18))}
            placeholder={text.whatName}
            className="box-border h-[34px] w-[152px] border border-[#2A150C] bg-[#FBF6D2] px-3 text-xs text-[#2A150C] outline-none"
          />
          <input
            aria-label={text.gameCode}
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
            placeholder={text.gameCode}
            className="box-border h-[34px] w-[108px] border border-[#2A150C] bg-[#FBF6D2] px-3 font-mono text-xs tracking-[0.14em] text-[#2A150C] uppercase outline-none"
          />
          <button type="submit" className="box-border h-[34px] border border-[#2A150C] bg-[#FAD5B3] px-3 text-xs text-[#2A150C]">
            {text.join}
          </button>
        </form>
      ) : (
        <div className="space-y-2">
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-[#2A150C]">{text.whatName}</span>
            <input
              aria-label={text.whatName}
              value={hostName}
              onChange={(event) => {
                const next = event.target.value.slice(0, 18);
                setHostName(next);
                onNickname(next);
              }}
              className={`${fieldClass} bg-[#FBF6D2]`}
            />
          </label>
          <label className="flex items-center justify-between gap-3">
            <span className="text-sm text-[#2A150C]">{text.startWhen}</span>
            <input
              type="datetime-local"
              aria-label={text.startWhen}
              value={localInputValue(startsAt)}
              onChange={(event) => {
                const next = new Date(event.target.value).getTime();
                if (Number.isFinite(next)) onStartsAt(next);
              }}
              className="box-border h-[34px] w-[210px] border border-[#2A150C] bg-[#FBF6D2] px-2 text-xs text-[#2A150C] outline-none"
            />
          </label>
          <div>
            <p className="text-xs text-[#5C3014]">{text.gameCode}</p>
            <p className="font-mono text-2xl tracking-[0.28em] text-[#2A150C]">{room?.code ?? "······"}</p>
          </div>
          <div>
            <p className="text-xs text-[#5C3014]">{text.joinLink}</p>
            <p className="truncate text-xs text-[#2A150C]">{joinUrl || "—"}</p>
            <button
              type="button"
              className="mt-1 h-[34px] border border-[#2A150C] bg-[#FBF6D2] px-3 text-xs text-[#2A150C]"
              onClick={() => {
                if (!joinUrl) return;
                void navigator.clipboard.writeText(joinUrl).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                });
              }}
            >
              {copied ? text.copied : text.copyLink}
            </button>
          </div>
          {room ? (
            <CountdownLine startsAt={room.startsAt} template={text.startsIn} />
          ) : null}
          <PlayerNames label={text.playersWaiting} players={room?.players ?? []} />
          <p className="text-xs text-[#5C3014]">{text.sameQuestions}</p>
        </div>
      )}
      {error ? <p className="text-sm text-[#8a3d32]">{error}</p> : null}
    </div>
  );
}

export function JoinPanel({
  locale,
  code,
  joined,
  players,
  startsAt,
  error,
  onJoin,
}: {
  locale: LocaleId;
  code: string;
  joined: boolean;
  players: { id: string; name: string }[];
  startsAt: number;
  error: string | null;
  onJoin: (name: string) => void;
}) {
  const text = messages(locale);
  const [name, setName] = useState("");

  return (
    <div className={panelClass}>
      <SheetHandle />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-5">
        <h1 className={`${questionType} ${ink}`}>{text.joinThisGame}</h1>
        <p className="font-mono text-3xl tracking-[0.28em] text-[#2A150C]">{code}</p>
        {startsAt > 0 ? (
          <CountdownLine startsAt={startsAt} template={text.startsIn} />
        ) : null}
        <PlayerNames label={text.playersWaiting} players={players} />
        <p className="text-xs text-[#5C3014]">{text.sameQuestions}</p>
        {joined ? null : (
          <form
            className="space-y-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (!name.trim()) return;
              onJoin(name);
            }}
          >
            <label className="block text-sm text-[#2A150C]">
              {text.whatName}
              <input
                aria-label={text.whatName}
                value={name}
                onChange={(event) => setName(event.target.value.slice(0, 18))}
                className="mt-1 box-border h-[34px] w-full border border-[#2A150C] bg-[#FBF6D2] px-3 text-sm text-[#2A150C] outline-none"
              />
            </label>
            <button
              type="submit"
              disabled={!name.trim()}
              className="h-9 border border-[#2A150C] bg-[#FAD5B3] px-4 text-sm text-[#2A150C] disabled:opacity-40"
            >
              {text.join}
            </button>
          </form>
        )}
        {error ? <p className="text-sm text-[#8a3d32]">{error}</p> : null}
      </div>
    </div>
  );
}

export function ScoreList({ rows }: { rows: { playerId: string; name: string; score: number }[] }) {
  return (
    <ol className="pointer-events-none absolute top-[calc(4.75rem+env(safe-area-inset-top))] left-3 z-40 w-44 border border-[#2A150C] bg-[#E2ECC0] text-[#2A150C] xl:top-16">
      {rows.map((row, index) => (
        <li
          key={row.playerId}
          className="flex items-baseline justify-between gap-2 border-b border-[#2A150C] px-2 py-1 text-xs last:border-b-0"
        >
          <span className="min-w-0 truncate">
            {index + 1}. {row.name}
          </span>
          <span className="shrink-0 font-mono tabular-nums">{formatScore(row.score)}</span>
        </li>
      ))}
    </ol>
  );
}

export function WaitingScreen({
  state,
  onLeave,
}: {
  state: EngineState;
  onLeave: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const others = state.players.filter((player) => player.id !== state.playerId);
  const full = !state.isHost && others.length >= 2;

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
      <section className={`${glass} w-full max-w-md p-6 text-center`}>
        <p className="text-xs uppercase tracking-[0.18em] text-[#2f4a52]">
          {state.isHost ? "Room code" : "Joining"}
        </p>
        <p className="mt-2 font-mono text-5xl tracking-[0.28em] text-[#2f4a52]">{state.roomCode}</p>
        <Button
          type="button"
          variant="secondary"
          className="mt-4"
          onClick={() => {
            if (!state.roomCode) return;
            void navigator.clipboard.writeText(state.roomCode).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            });
          }}
        >
          <Copy className="h-4 w-4" />
          {copied ? "Copied" : "Copy code"}
        </Button>
        <div className="mt-5 space-y-2 text-left">
          <PlayerRow name={state.localName} detail={state.isHost ? "Host · you" : "You"} />
          {others.length === 0 ? (
            <p className="rounded-xl border border-dashed border-[#2f4a52]/20 px-3 py-3 text-sm text-[#2f4a52]">
              {state.connection === "error"
                ? state.connectionError
                : state.connection === "connecting"
                  ? "Connecting to the room…"
                  : state.isHost
                    ? "Waiting for an opponent to join."
                    : "Waiting for the host to open this room."}
            </p>
          ) : (
            others.map((player) => (
              <PlayerRow key={player.id} name={player.name} detail={player.role === "host" ? "Host" : "Guest"} />
            ))
          )}
        </div>
        {full || state.notice ? (
          <p className="mt-3 text-sm text-[#8a3d32]">{state.notice ?? "This room already has two players."}</p>
        ) : null}
        {state.connection === "error" && others.length > 0 ? (
          <p className="mt-3 text-sm text-[#8a3d32]">{state.connectionError}</p>
        ) : null}
        <Button type="button" variant="ghost" className="mt-4" onClick={onLeave}>
          Back to lobby
        </Button>
      </section>
    </div>
  );
}

function divisionAreaRound(city: { id: string }, state: EngineState): boolean {
  return city.id.includes(":province:") && (state.playFormat !== "quiz" || state.quizStep === 2);
}

function pinKind(city: { id: string }, state: EngineState): "country" | "province" | "state" | "city" {
  if (state.playFormat === "quiz" && state.quizStep === 3) return "city";
  if (city.id.startsWith("united-states:province:")) return "state";
  if (city.id.includes(":province:")) return "province";
  if (city.id.includes(":country:")) return "country";
  return "city";
}

function pinQuestion(text: ReturnType<typeof messages>, city: { id: string; name: string; capitalName?: string }, state: EngineState): string {
  const kind = pinKind(city, state);
  const name =
    kind === "city"
      ? (city.capitalName ?? city.name)
      : kind === "country"
        ? localPlaceName(state.locale, city.name)
        : city.name;
  if (kind === "province") return fill(text.whereIsProvince, { name });
  if (kind === "state") return fill(text.whereIsState, { name });
  if (kind === "country") return fill(text.whereIsCountry, { name });
  return fill(text.whereIsCity, { name });
}

function divisionPinLine(
  text: ReturnType<typeof messages>,
  locale: LocaleId,
  guess: { confirmed: boolean; place: string | null } | undefined,
): string {
  if (!guess?.confirmed) return text.noPin;
  if (!guess.place) return text.pinWasOceanBare;
  return fill(text.pinWasIn, { place: localPlaceName(locale, guess.place) });
}

function worldPinLine(
  text: ReturnType<typeof messages>,
  locale: LocaleId,
  guess: { confirmed: boolean; place: string | null; distanceKm: number | null } | undefined,
  targetName: string,
): string {
  if (!guess?.confirmed) return text.noPin;
  const target = localPlaceName(locale, targetName);
  const distance = formatKm(guess.distanceKm);
  if (!guess.place) return fill(text.pinWasOcean, { distance, target });
  const place = localPlaceName(locale, guess.place);
  return fill(text.pinWasAway, { place, distance, target });
}

function PlayerRow({ name, detail }: { name: string; detail: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-[#e2f6fe] px-3 py-2">
      <span className="text-sm text-[#2f4a52]">{name}</span>
      <span className="font-mono text-[11px] uppercase tracking-wider text-[#2f4a52]">{detail}</span>
    </div>
  );
}

export function PlayOverlay({ state, onEnd }: { state: EngineState; onEnd: () => void }) {
  const cityId = state.cityIds[state.roundIndex];
  const city = cityId ? getPlace(cityId) : null;
  const part = state.playFormat === "quiz" && state.quizStep === 3 ? 1 : 0;
  const record = state.history.find((round) => round.roundIndex === state.roundIndex && (round.part ?? 0) === part);
  const showingResult = state.phase === "ROUND_RESULT" && record != null;
  const guessing = state.phase === "GUESSING_ACTIVE";
  const timed = state.mapDifficulty !== "kids";
  const frozen = state.submitted ? (state.localGuess?.timeRemaining ?? 0) : null;
  const now = useNow(timed && guessing && frozen == null && state.guessingEndsAt != null);
  const remaining =
    frozen ??
    (state.guessingEndsAt == null
      ? GUESS_MS / 1000
      : Math.max(0, Math.min(GUESS_MS / 1000, (state.guessingEndsAt - now) / 1000)));
  const urgent = timed && guessing && remaining <= 2;
  const lastSecond = useRef<number | null>(null);
  const text = messages(state.locale);
  const mine = record?.guesses.find((guess) => guess.playerId === state.playerId);
  const note = mine ? placeNote(mine.place, mine.confirmed, city?.country ?? "") : null;
  const divisionArea = city ? divisionAreaRound(city, state) : false;
  const resultLine =
    showingResult && city
      ? divisionArea
        ? divisionPinLine(text, state.locale, mine)
        : city.id.includes(":country:") || city.id.includes(":province:")
          ? worldPinLine(text, state.locale, mine, city.name)
          : null
      : null;

  useEffect(() => {
    if (!timed || !guessing || frozen != null) return;
    const second = Math.ceil(remaining);
    if (lastSecond.current != null && second < lastSecond.current && second > 0 && second <= 3) {
      playTick();
    }
    lastSecond.current = second;
  }, [frozen, guessing, remaining, timed]);

  if (!city) return null;

  return (
    <>
      <div className="pointer-events-none absolute top-3 right-3 z-20">
        <div className="pointer-events-auto">
          <MuteButton />
        </div>
        {state.notice ? (
          <p className={`${glass} mt-2 max-w-xs px-3 py-2 text-sm text-[#2f4a52]`}>{state.notice}</p>
        ) : null}
      </div>

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 px-3 pb-[env(safe-area-inset-bottom)] xl:right-36">
        <div className={`${glass} pointer-events-auto flex h-14 w-full items-center gap-3 px-3`}>
          <p className="shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] text-[#2A150C] tabular-nums">
            {fill(text.round, {
              current: String(state.roundIndex + 1),
              total: String(state.cityIds.length),
            })}
          </p>
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-[#2A150C]">
            {showingResult
              ? (resultLine ??
                `${mine?.confirmed ? formatKm(mine.distanceKm) : text.noPin}${note ? ` · ${note}` : ""}`)
              : pinQuestion(text, city, state)}
          </p>
          <p
            className={`w-12 shrink-0 text-right font-mono text-sm tabular-nums ${urgent ? "text-[#8a3d32]" : "text-[#2A150C]"}`}
          >
            {timed && guessing && state.guessingEndsAt != null ? `${remaining.toFixed(1)}s` : ""}
          </p>
          <span className="xl:hidden">
            <EndGameIcon label={text.endGame} onEnd={onEnd} />
          </span>
        </div>
      </div>
    </>
  );
}

export function QuizCard({
  state,
  onChoose,
}: {
  state: EngineState;
  onChoose: (choice: string) => void;
}) {
  const id = state.cityIds[state.roundIndex];
  const place = id ? getPlace(id) : null;
  const text = messages(state.locale);
  const timed = state.mapDifficulty !== "kids";
  const asking = state.phase === "QUIZ_QUESTION";
  const now = useNow(timed && asking && state.guessingEndsAt != null);
  if (!place || state.seed == null || (state.quizStep !== 0 && state.quizStep !== 1)) return null;
  const card = quizCard(state.seed, state.roundIndex, state.quizStep, place, quizPool(state.region), state.locale, {
    category: state.questionCategory,
    difficulty: state.mapDifficulty,
    placeMode: state.placeMode,
    region: state.region,
  });
  const remaining =
    state.guessingEndsAt == null
      ? null
      : Math.max(0, Math.min(GUESS_MS / 1000, (state.guessingEndsAt - now) / 1000));
  const feedback = state.phase === "QUIZ_FEEDBACK";

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center p-3 md:p-4">
      <section className={`${glass} flex max-h-[calc(100%-1rem)] w-full max-w-[18rem] flex-col overflow-y-auto p-4 md:h-[24.5rem] md:max-h-none md:max-w-md md:p-5`}>
        <p className="h-5 font-mono text-[11px] leading-5 uppercase tracking-[0.16em] text-[#2f4a52] tabular-nums">
          {fill(text.round, {
            current: String(state.roundIndex + 1),
            total: String(state.cityIds.length),
          })}
          <span> · {fill(text.points, { score: formatScore(matchTotal(state)) })}</span>
        </p>
        <p className="mt-3 line-clamp-4 text-lg leading-7 font-medium text-[#2f4a52] md:h-[5.25rem] md:line-clamp-none">{card.prompt}</p>
        <p
          className={`mt-1 h-5 font-mono text-sm leading-5 tabular-nums ${remaining != null && remaining <= 2 ? "text-[#8a3d32]" : "text-[#2f4a52]"}`}
        >
          {remaining != null && asking ? `${remaining.toFixed(1)}s` : "\u00a0"}
        </p>
        <div className="mt-4 flex flex-col gap-2" role="group" aria-label="Answers">
          {card.choices.map((choice) => {
            const chosen = state.quizChoice === choice;
            const right = feedback && choice === card.correct;
            const wrong = feedback && chosen && !state.quizCorrect;
            const picked = !feedback && chosen;
            return (
              <button
                key={choice}
                type="button"
                disabled={feedback || (state.mode === "multi" && state.submitted)}
                onClick={() => onChoose(choice)}
                className={`h-10 shrink-0 truncate rounded-full border px-3 text-sm font-medium ${
                  right
                    ? "border-[#2A150C] bg-[#E2ECC0] text-[#2A150C]"
                    : wrong
                      ? "border-[#2A150C] bg-[#F8AFAF] text-[#2A150C]"
                      : picked
                        ? "border-[#2A150C] bg-[#FAD5B3] text-[#2A150C]"
                        : "border-[#d0d0d0] bg-white text-[#2f4a52]"
                }`}
              >
                {choice}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export function QuestionBar({ state, onEnd }: { state: EngineState; onEnd: () => void }) {
  const id = state.cityIds[state.roundIndex];
  const place = id ? getPlace(id) : null;
  const text = messages(state.locale);
  const timed = state.mapDifficulty !== "kids";
  const asking = state.phase === "QUIZ_QUESTION";
  const now = useNow(timed && asking && state.guessingEndsAt != null);
  if (!place || state.seed == null || (state.quizStep !== 0 && state.quizStep !== 1)) return null;
  const card = quizCard(state.seed, state.roundIndex, state.quizStep, place, quizPool(state.region), state.locale, {
    category: state.questionCategory,
    difficulty: state.mapDifficulty,
    placeMode: state.placeMode,
    region: state.region,
  });
  const remaining =
    state.guessingEndsAt == null
      ? null
      : Math.max(0, Math.min(GUESS_MS / 1000, (state.guessingEndsAt - now) / 1000));

  return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-20 px-3 pb-[env(safe-area-inset-bottom)] xl:hidden">
      <div className={`${glass} pointer-events-auto flex h-14 w-full items-center gap-3 px-3`}>
        <p className="shrink-0 font-mono text-[11px] uppercase tracking-[0.12em] text-[#2A150C] tabular-nums">
          {fill(text.round, {
            current: String(state.roundIndex + 1),
            total: String(state.cityIds.length),
          })}
        </p>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-[#2A150C]">{card.prompt}</p>
        <p
          className={`w-12 shrink-0 text-right font-mono text-sm tabular-nums ${remaining != null && remaining <= 2 ? "text-[#8a3d32]" : "text-[#2A150C]"}`}
        >
          {remaining != null && asking ? `${remaining.toFixed(1)}s` : ""}
        </p>
        <EndGameIcon label={text.endGame} onEnd={onEnd} />
      </div>
    </div>
  );
}

function recapAnswer(text: ReturnType<typeof messages>, question: RecapQuestion, answer: RecapQuestion["answers"][number]): string {
  if (question.kind === "choice") return answer.choice?.trim() ? answer.choice : text.noAnswer;
  if (!answer.confirmed) return text.noPin;
  if (question.binary) return answer.correct ? text.rightAnswer : text.wrongAnswer;
  const place = answer.place?.trim();
  const distance = formatKm(answer.distanceKm);
  return place ? `${place} · ${distance}` : distance;
}

export function FinalScreen({
  state,
  onAgain,
  recap = null,
}: {
  state: EngineState;
  onAgain: () => void;
  recap?: RecapQuestion[] | null;
}) {
  const standings = recap
    ? [...recap.reduce((map, question) => {
        for (const answer of question.answers) {
          const row = map.get(answer.playerId) ?? { name: answer.name, score: 0 };
          row.score += answer.points;
          map.set(answer.playerId, row);
        }
        return map;
      }, new Map<string, { name: string; score: number }>()).values()].sort((a, b) => b.score - a.score)
    : [];
  const total = recap
    ? (standings.find((row) => row.name === state.localName)?.score ??
      recap.reduce((sum, question) => sum + (question.answers.find((answer) => answer.playerId === state.playerId)?.points ?? 0), 0))
    : matchTotal(state);
  const text = messages(state.locale);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    let frame = 0;
    const colors = ["#F8AFAF", "#FFC2AA", "#FAD5B3", "#FBF6D2", "#E2ECC0"];
    void import("canvas-confetti").then(({ default: confetti }) => {
      if (cancelled) return;
      const end = Date.now() + 1400;
      const burst = () => {
        void confetti({ particleCount: 4, angle: 60, spread: 58, origin: { x: 0, y: 0.72 }, colors });
        void confetti({ particleCount: 4, angle: 120, spread: 58, origin: { x: 1, y: 0.72 }, colors });
        if (!cancelled && Date.now() < end) frame = window.requestAnimationFrame(burst);
      };
      burst();
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="pointer-events-none absolute top-3 right-3 left-3 z-20 sm:top-4 sm:right-auto sm:left-4 sm:w-[24rem]">
      <motion.section
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        aria-label="Match overview"
        className={`${glass} pointer-events-auto max-h-[calc(100dvh-2rem)] w-full overflow-y-auto p-4 sm:p-5`}
      >
        <div className="flex items-center gap-2 text-[#8a5a22]">
          <Trophy className="h-5 w-5" />
          <p className="text-xs uppercase tracking-[0.18em]">{text.matchComplete}</p>
        </div>
        <p className="mt-3 text-xs font-medium text-[#2f4a52]">{text.totalScore}</p>
        <p className="font-mono text-4xl tabular-nums text-[#2f4a52]">{formatScore(total)}</p>
        {standings.length > 0 ? (
          <ol className="mt-3 space-y-1">
            {standings.map((row, index) => (
              <li key={`${row.name}-${index}`} className="flex items-baseline justify-between gap-3 text-sm text-[#2f4a52]">
                <span>
                  {index + 1}. {row.name}
                </span>
                <span className="font-mono tabular-nums">{formatScore(row.score)}</span>
              </li>
            ))}
          </ol>
        ) : null}
        {recap ? (
          <ol className="mt-4 space-y-3">
            {recap.map((question, index) => (
              <li key={`${question.roundIndex}-${question.step}`} className="text-sm text-[#2f4a52]">
                <p>
                  {index + 1}. {question.prompt}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {question.answers.map((answer) => (
                    <li key={answer.playerId}>
                      {answer.name} — {recapAnswer(text, question, answer)}
                    </li>
                  ))}
                </ul>
                {question.kind === "choice" && question.correct ? (
                  <p>{fill(text.answerWas, { name: question.correct })}</p>
                ) : null}
                <p>{question.winnerName ? fill(text.cameFirst, { name: question.winnerName }) : text.nobodyFirst}</p>
              </li>
            ))}
          </ol>
        ) : null}
        {recap ? null : (
        <ol className="mt-4 space-y-2">
          {state.history.map((round) => {
            const city = getPlace(round.cityId);
            const guess = round.guesses.find((item) => item.playerId === state.playerId);
            const title = round.label ?? city.name;
            return (
              <li key={`${round.roundIndex}-${round.part ?? 0}`} className="flex items-start justify-between gap-3 text-sm text-[#2f4a52]">
                <span>
                  {round.roundIndex + 1}. {title}
                  {state.playFormat === "pin" && !city.id.includes(":country:") ? (
                    <span className="font-normal">, {localPlaceName(state.locale, city.country)}</span>
                  ) : null}
                </span>
                <span className="shrink-0 text-right font-mono tabular-nums">
                  {city.id.includes(":province:") && (round.part ?? 0) === 0
                    ? guess?.confirmed
                      ? null
                      : text.noPin
                    : guess?.confirmed
                      ? formatKm(guess.distanceKm)
                      : text.noPin}
                  {city.id.includes(":province:") && (round.part ?? 0) === 0 && guess?.confirmed ? null : <span> · </span>}
                  <span>{fill(text.points, { score: formatScore(guess?.total ?? 0) })}</span>
                </span>
              </li>
            );
          })}
        </ol>
        )}
        <Button type="button" size="lg" className="mt-5 w-full" onClick={onAgain}>
          {text.playAgain}
        </Button>
      </motion.section>
    </div>
  );
}
