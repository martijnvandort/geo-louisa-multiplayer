import assert from "node:assert/strict";
import { CITIES, pickCityIds, type CityPool } from "../data/cities";
import {
  buildLockGuess,
  buildMiss,
  createInitialState,
  lineEndpoint,
  reducer,
  revealPlace,
  totalFor,
} from "../lib/game-engine";
import { greatCircleSegments, haversineKm, scoreFromDistance } from "../lib/geo";
import { readFileSync } from "node:fs";
import { COUNTRY_PACKS } from "../data/countries";
import { getPlace, pickPlaceIds, placeCount, placesFor, quizPlaceMode } from "../data/catalog";
import { quizCard, quizPool } from "../data/quiz";
import { boundsOf, selectLand, settleDateline, type LandFeature, type FeatureCollection } from "../lib/region-land";
import { drawnCountryAt, rememberLand } from "../lib/country-shapes";
import { sameCountry } from "../lib/place";
import { regionFrame, REGION_FRAMES } from "../lib/region-frames";
import { CONTINENT_COUNTRIES } from "../data/regions";

const ids = new Set(CITIES.map((city) => city.id));
assert.equal(ids.size, CITIES.length, "city ids must be unique");
assert.ok(CITIES.length >= 40, "need a real city set");
assert.ok(CITIES.filter((city) => /reykjavik|ulaanbaatar|antananarivo|honolulu|alice-springs/i.test(city.id)).length >= 5);

for (const city of CITIES) {
  const [lng, lat] = city.coordinates;
  assert.ok(lng >= -180 && lng <= 180, city.id);
  assert.ok(lat >= -90 && lat <= 90, city.id);
}

const paris = CITIES.find((city) => city.id === "paris");
const london = CITIES.find((city) => city.id === "london");
assert.ok(paris && london);
const parisLondon = haversineKm(paris.coordinates, london.coordinates);
assert.ok(parisLondon > 300 && parisLondon < 400, `Paris-London ${parisLondon}`);

const perfect = scoreFromDistance(0, 8);
assert.equal(perfect.distanceScore, 5000);
assert.equal(perfect.timeBonus, 1000);
assert.equal(perfect.total, 6000);

const half = scoreFromDistance(0, 4);
assert.equal(half.timeBonus, 500);

const far = scoreFromDistance(8000, 8);
assert.ok(far.distanceScore <= 1000);
assert.equal(far.timeBonus, 0);

const edge = scoreFromDistance(0, 0);
assert.equal(edge.distanceScore, 5000);
assert.equal(edge.timeBonus, 0);

const picked = pickCityIds(42, 10);
assert.equal(new Set(picked).size, 10);
assert.deepEqual(pickCityIds(42, 10), picked);

const euPool = CITIES.filter((city) => city.pools.includes("eu"));
const northPool = CITIES.filter((city) => city.pools.includes("north-america"));
const southPool = CITIES.filter((city) => city.pools.includes("south-america"));
assert.ok(euPool.length >= 10, `EU pool ${euPool.length}`);
assert.equal(northPool.length, 3, `North America pool ${northPool.length}`);
const centralPool = CITIES.filter((city) => city.pools.includes("central-america"));
assert.ok(centralPool.length >= 10, `Central America pool ${centralPool.length}`);
assert.ok(southPool.length >= 10, `South America pool ${southPool.length}`);
for (const city of CITIES) {
  if (["United Kingdom", "Norway", "Switzerland"].includes(city.country)) {
    assert.equal(city.pools.includes("eu"), false, city.id);
  }
  assert.ok(city.pools.length <= 1, `${city.id} is in more than one region`);
  if (!city.capital) assert.equal(city.pools.length, 0, `${city.id} is not a capital`);
}
assert.equal(CITIES.find((city) => city.id === "paris")?.pools.includes("eu"), true);
assert.equal(CITIES.find((city) => city.id === "dubrovnik")?.pools.includes("eu"), false);
assert.equal(CITIES.find((city) => city.id === "washington")?.pools.includes("north-america"), true);
assert.equal(CITIES.find((city) => city.id === "new-york")?.pools.includes("north-america"), false);
assert.equal(CITIES.find((city) => city.id === "honolulu")?.pools.length, 0);
assert.equal(CITIES.find((city) => city.id === "panama-city")?.pools.includes("central-america"), true);
assert.equal(CITIES.find((city) => city.id === "panama-city")?.pools.includes("north-america"), false);
assert.equal(CITIES.find((city) => city.id === "havana")?.pools.includes("central-america"), true);
assert.equal(CITIES.find((city) => city.id === "bogota")?.pools.includes("south-america"), true);
assert.equal(CITIES.find((city) => city.id === "bogota")?.pools.includes("north-america"), false);
assert.equal(CITIES.find((city) => city.id === "rio-de-janeiro")?.pools.length, 0);
assert.equal(CITIES.find((city) => city.id === "nuuk")?.pools.length, 0);
const euPicked = pickCityIds(9, 10, "eu");
assert.equal(euPicked.length, 10);
assert.ok(euPicked.every((id) => CITIES.find((city) => city.id === id)?.pools.includes("eu")));
assert.ok(!euPicked.some((id) => ["london", "oslo", "bern", "dubrovnik"].includes(id)));
for (const region of ["north-america", "south-america", "eu"] as const) {
  const picked = pickCityIds(3, 10, region);
  assert.ok(picked.every((id) => CITIES.find((city) => city.id === id)?.pools.includes(region)));
  const [[west, south], [east, north]] = REGION_FRAMES[region];
  for (const city of CITIES.filter((item) => item.pools.includes(region satisfies CityPool))) {
    const [lng, lat] = city.coordinates;
    assert.ok(lng >= west && lng <= east && lat >= south && lat <= north, `${city.id} outside ${region}`);
  }
}

let state = createInitialState("player-a");
state = reducer(state, { type: "SET_DIFFICULTY", difficulty: "hard" });
state = reducer(state, { type: "SET_REGION", region: "eu" });
state = reducer(state, { type: "SET_NICKNAME", nickname: "Ada" });
state = reducer(state, { type: "START_SOLO", now: 1_000, seed: 42 });
assert.equal(state.phase, "GUESSING_ACTIVE");
assert.equal(state.mapDifficulty, "hard");
assert.equal(state.region, "eu");
assert.equal(state.localName, "Ada");
assert.equal(state.cityIds.length, 10);
assert.equal(state.guessingEndsAt, 1_000 + 8_000);
assert.ok(state.cityIds.every((id) => CITIES.find((city) => city.id === id)?.pools.includes("eu")));

const target = CITIES.find((city) => city.id === state.cityIds[0]);
assert.ok(target);
state = reducer(state, { type: "PLACE_PIN", coordinates: target.coordinates });
const guess = buildLockGuess(state, state.guessingEndsAt! - 7_500);
assert.ok(guess);
state = reducer(state, { type: "RESOLVE_SOLO", guess, now: 12_000 });
assert.equal(state.phase, "ROUND_RESULT");
const round = state.history[0];
assert.ok(round);
assert.equal(round.guesses[0]?.distanceScore, 5000);
assert.ok((round.guesses[0]?.timeBonus ?? 0) > 0);
assert.equal(totalFor(state.history, "player-a"), round.guesses[0]?.total);

state = reducer(state, { type: "NEXT_ROUND", roundIndex: 1, previewStartedAt: 20_000 });
assert.equal(state.phase, "GUESSING_ACTIVE");
assert.equal(state.guessingEndsAt, 28_000);
state = reducer(state, { type: "RESOLVE_SOLO", guess: buildMiss(state), now: 40_000 });
assert.equal(state.history[1]?.guesses[0]?.total, 0);

for (let roundIndex = 2; roundIndex < 10; roundIndex += 1) {
  state = reducer(state, { type: "NEXT_ROUND", roundIndex, previewStartedAt: 50_000 + roundIndex });
  state = reducer(state, { type: "RESOLVE_SOLO", guess: buildMiss(state), now: 60_000 + roundIndex });
}
state = reducer(state, { type: "NEXT_ROUND", roundIndex: 10, previewStartedAt: 90_000 });
assert.equal(state.phase, "FINAL_RESULTS");

let multi = reducer(createInitialState("host"), { type: "CREATE_ROOM", code: "ABCD" });
multi = reducer(multi, {
  type: "MATCH_START",
  seed: 7,
  difficulty: "normal",
  region: "north-america",
  previewStartedAt: 5_000,
  rosterIds: ["host", "guest"],
});
assert.equal(multi.phase, "GUESSING_ACTIVE");
assert.equal(multi.region, "north-america");
assert.ok(multi.cityIds.every((id) => CITIES.find((city) => city.id === id)?.pools.includes("north-america")));
multi = reducer(multi, { type: "PLACE_PIN", coordinates: [0, 0] });
const locked = buildLockGuess(multi, multi.guessingEndsAt! - 1_000);
assert.ok(locked);
multi = reducer(multi, { type: "LOCAL_LOCK", guess: locked });
assert.equal(multi.phase, "GUESSING_ACTIVE", "a single lock must not reveal");
multi = reducer(multi, {
  type: "REMOTE_LOCK",
  lock: { playerId: "guest", name: "Guest", roundIndex: 0, timeRemaining: 4 },
});
assert.equal(multi.phase, "GUESSING_ACTIVE", "locks still hide coordinates");
multi = reducer(multi, { type: "OPEN_REVEAL", guess: locked, now: 9_000 });
assert.equal(multi.phase, "GUESSING_ACTIVE");
multi = reducer(multi, {
  type: "REMOTE_REVEAL",
  now: 9_100,
  guess: {
    playerId: "guest",
    name: "Guest",
    roundIndex: 0,
    coordinates: [10, 10],
    confirmed: true,
    timeRemaining: 4,
    place: "Brazil",
  },
});
assert.equal(multi.phase, "ROUND_RESULT");
assert.equal(multi.history[0]?.guesses.length, 2);

const netherlands = COUNTRY_PACKS.find((pack) => pack.id === "netherlands");
assert.ok(netherlands);
assert.equal(netherlands.capitals.length, 1);
assert.equal(netherlands.capitals[0]?.name, "Amsterdam");
assert.equal(netherlands.provinces.length, 12);
assert.deepEqual(
  netherlands.provinces.map((place) => place.name),
  [
    "Drenthe",
    "Flevoland",
    "Friesland",
    "Gelderland",
    "Groningen",
    "Limburg",
    "Noord-Brabant",
    "Noord-Holland",
    "Overijssel",
    "Utrecht",
    "Zeeland",
    "Zuid-Holland",
  ],
);
assert.equal(netherlands.topCities.length, 50);
assert.equal(new Set(netherlands.topCities.map((place) => place.name)).size, 50);
assert.equal(netherlands.topCities[0]?.name, "Amsterdam");
assert.equal(netherlands.topCities.at(-1)?.name, "Roosendaal");
assert.equal(
  netherlands.topCities.some((place) => /bonaire|saba|eustatius/i.test(place.name)),
  false,
);
const [[nlWest, nlSouth], [nlEast, nlNorth]] = netherlands.bounds;
for (const place of [...netherlands.capitals, ...netherlands.provinces, ...netherlands.topCities]) {
  const [lng, lat] = place.coordinates;
  assert.ok(lng >= nlWest && lng <= nlEast && lat >= nlSouth && lat <= nlNorth, place.name);
}
assert.deepEqual(regionFrame("netherlands"), netherlands.bounds);

const countries = JSON.parse(
  readFileSync(new URL("../public/countries.geojson", import.meta.url), "utf8"),
) as FeatureCollection<LandFeature>;

function centers(region: string) {
  const land = selectLand(region, countries);
  return land.features.flatMap((feature) => {
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    return polygons.map((rings) => {
      const ring = rings[0] ?? [];
      let west = Infinity;
      let east = -Infinity;
      let south = Infinity;
      let north = -Infinity;
      for (const [lng, lat] of ring) {
        if (lng < west) west = lng;
        if (lng > east) east = lng;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      }
      return { name: feature.properties.name, lng: (west + east) / 2, lat: (south + north) / 2 };
    });
  });
}

const euLand = selectLand("eu", countries);
const euNames = new Set(euLand.features.map((feature) => feature.properties.name));
for (const name of ["France", "Ireland", "Portugal", "Spain", "Finland", "Cyprus", "Netherlands", "Greece"]) {
  assert.equal(euNames.has(name), true, name);
}
for (const name of ["Russia", "United Kingdom", "Norway", "Switzerland", "Greenland", "Turkey"]) {
  assert.equal(euNames.has(name), false, name);
}
assert.equal(centers("eu").some((part) => part.name === "France" && part.lng < -20), false);
assert.equal(centers("eu").some((part) => part.name === "France" && part.lat > 41), true);

const naNames = new Set(selectLand("north-america", countries).features.map((feature) => feature.properties.name));
for (const name of ["Canada", "United States", "Mexico"]) {
  assert.equal(naNames.has(name), true, name);
}
for (const name of ["Panama", "Cuba", "Colombia", "Greenland", "Brazil", "Russia"]) {
  assert.equal(naNames.has(name), false, name);
}
const centralNames = new Set(selectLand("central-america", countries).features.map((feature) => feature.properties.name));
assert.equal(centralNames.has("Panama"), true);
assert.equal(centralNames.has("Cuba"), true);
assert.equal(centralNames.has("Canada"), false);
assert.equal(centralNames.has("Mexico"), false);
assert.equal(centralNames.has("United States"), false);
const usParts = centers("north-america").filter((part) => part.name === "United States");
assert.equal(usParts.some((part) => part.lng < -160 && part.lat > 50), true, "Alaska");
assert.equal(usParts.some((part) => part.lat < 25), false, "Hawaii");

const saNames = new Set(selectLand("south-america", countries).features.map((feature) => feature.properties.name));
assert.equal(saNames.has("Colombia"), true);
assert.equal(saNames.has("Argentina"), true);
assert.equal(saNames.has("Panama"), false);

const nlLand = selectLand("netherlands", countries);
assert.deepEqual(nlLand.features.map((feature) => feature.properties.name), ["Netherlands"]);
const nlGeometry = boundsOf(nlLand.features);
assert.ok(nlGeometry);
assert.ok(nlGeometry[0][0] > 3 && nlGeometry[1][0] < 8);
assert.ok(nlGeometry[0][1] > 50 && nlGeometry[1][1] < 54);
assert.equal(centers("netherlands").some((part) => part.lng < 0), false);
assert.equal(placeCount("eu", "countries"), 27);
assert.ok(placeCount("world", "countries") >= 40);
assert.equal(placeCount("north-america", "countries"), 3);
assert.ok(placeCount("central-america", "countries") >= 10);
const membership = new Map<string, string>();
for (const [id, names] of Object.entries(CONTINENT_COUNTRIES)) {
  for (const name of names) {
    assert.equal(membership.get(name), undefined, `${name} is in ${membership.get(name)} and ${id}`);
    membership.set(name, id);
  }
}
assert.equal(placesFor("netherlands", "division-capitals")[0]?.name, "Assen");
assert.equal(placesFor("united-states", "capitals").find((place) => place.name === "Albany")?.name, "Albany");
assert.equal(placeCount("eu", "provinces"), 12);
assert.equal(placeCount("world", "top-cities"), 50);
assert.equal(placeCount("north-america", "provinces"), 0);
assert.equal(placeCount("south-america", "top-cities"), 0);
assert.equal(placesFor("netherlands", "capitals")[0]?.name, "Amsterdam");
assert.ok(placesFor("eu", "provinces").every((place) => place.country === "The Netherlands"));
assert.ok(placesFor("eu", "capitals").every((place) => CITIES.find((city) => city.id === place.id)?.pools.includes("eu")));

let empty = reducer(createInitialState("player-a"), { type: "SET_REGION", region: "north-america" });
empty = reducer(empty, { type: "SET_PLACE_MODE", placeMode: "provinces" });
empty = reducer(empty, { type: "START_SOLO", now: 1_000, seed: 3 });
assert.equal(empty.phase, "LOBBY");

let dutch = reducer(createInitialState("player-a"), { type: "SET_REGION", region: "netherlands" });
dutch = reducer(dutch, { type: "START_SOLO", now: 2_000, seed: 4 });
assert.equal(dutch.phase, "GUESSING_ACTIVE");
assert.equal(dutch.placeMode, "capitals");
assert.equal(dutch.cityIds.length, 1);
assert.equal(getPlace(dutch.cityIds[0]!).name, "Amsterdam");
dutch = reducer(dutch, { type: "RESOLVE_SOLO", guess: buildMiss(dutch), now: 3_000 });
dutch = reducer(dutch, { type: "NEXT_ROUND", roundIndex: 1, previewStartedAt: 4_000 });
assert.equal(dutch.phase, "FINAL_RESULTS");

let provinces = reducer(createInitialState("player-a"), { type: "SET_REGION", region: "netherlands" });
provinces = reducer(provinces, { type: "SET_PLACE_MODE", placeMode: "provinces" });
provinces = reducer(provinces, { type: "START_SOLO", now: 5_000, seed: 8 });
assert.equal(provinces.cityIds.length, 10);
assert.equal(new Set(provinces.cityIds).size, 10);
assert.ok(provinces.cityIds.every((id) => id.startsWith("netherlands:province:")));
assert.equal(pickPlaceIds(8, "netherlands", "provinces").length, 10);
assert.equal(pickPlaceIds(8, "eu", "top-cities").length, 10);
assert.ok(pickPlaceIds(8, "eu", "top-cities").every((id) => id.startsWith("netherlands:city:")));

let quiz = reducer(createInitialState("player-a"), { type: "SET_REGION", region: "netherlands" });
quiz = reducer(quiz, { type: "SET_DIFFICULTY", difficulty: "kids" });
quiz = reducer(quiz, { type: "START_SOLO", now: 9_000, seed: 11, format: "quiz" });
assert.equal(quiz.phase, "QUIZ_QUESTION");
assert.equal(quiz.playFormat, "quiz");
assert.equal(quiz.guessingEndsAt, null);
assert.equal(quiz.cityIds.length, 10);
assert.ok(quiz.cityIds.every((id) => id.startsWith("netherlands:province:")));
const quizPlace = getPlace(quiz.cityIds[0]!);
const capitalCard = quizCard(11, 0, 0, quizPlace, placesFor("netherlands", quizPlaceMode("netherlands")));
assert.match(capitalCard.prompt, /province capital/);
const dutchCard = quizCard(11, 0, 0, quizPlace, placesFor("netherlands", quizPlaceMode("netherlands")), "nl");
assert.match(dutchCard.prompt, /hoofdstad van de provincie/);
assert.equal(capitalCard.choices.length, 3);
assert.ok(capitalCard.choices.includes(capitalCard.correct));
const cityCard = quizCard(11, 0, 1, quizPlace, placesFor("netherlands", quizPlaceMode("netherlands")));
assert.equal(cityCard.choices.length, 3);
assert.equal(new Set(cityCard.choices).size, 3);
assert.ok(cityCard.choices.includes(cityCard.correct));
for (const choice of capitalCard.choices) {
  assert.equal(cityCard.choices.includes(choice), false, `${choice} was repeated`);
}
for (const region of ["asia", "oceania", "africa", "middle-east", "central-america"]) {
  let match = reducer(createInitialState("player-a"), { type: "SET_REGION", region });
  match = reducer(match, { type: "START_SOLO", now: 12_000, seed: 5, format: "quiz" });
  assert.equal(match.phase, "QUIZ_QUESTION", region);
  assert.ok(match.cityIds.length > 0, region);
  for (const id of match.cityIds) assert.equal(getPlace(id).id, id, id);
}
const worldPlaces = placesFor("world", "countries");
const usPlaces = placesFor("united-states", "provinces");
const georgia = worldPlaces.find((place) => place.name === "Georgia");
const georgiaState = usPlaces.find((place) => place.name === "Georgia");
assert.ok(georgia && georgiaState);
const sharedNames = worldPlaces
  .map((place) => place.name)
  .filter((name) => usPlaces.some((state) => state.name === name) || placesFor("netherlands", "provinces").some((province) => province.name === name));
assert.deepEqual(sharedNames, ["Georgia"]);
for (let seed = 0; seed < 24; seed += 1) {
  const countryCapital = quizCard(seed, 0, 0, georgia, worldPlaces);
  const stateCapital = quizCard(seed, 0, 0, georgiaState, usPlaces);
  assert.equal(countryCapital.correct, "Tbilisi");
  assert.equal(stateCapital.correct, "Atlanta");
  assert.equal(quizCard(seed, 0, 0, georgia, worldPlaces, "nl").prompt, "Wat is de hoofdstad van Georgië?");
  assert.match(quizCard(seed, 0, 0, georgiaState, usPlaces, "nl").prompt, /staat Georgia/);
  const countryCity = quizCard(seed, 0, 1, georgia, worldPlaces);
  const stateCity = quizCard(seed, 0, 1, georgiaState, usPlaces);
  assert.equal(countryCity.correct, "Batumi");
  assert.match(countryCity.prompt, /country of Georgia/);
  assert.ok(stateCity.correct === "Augusta" || stateCity.correct === "Columbus", stateCity.correct);
  assert.match(stateCity.prompt, /state of Georgia/);
  assert.match(quizCard(seed, 0, 1, georgia, worldPlaces, "nl").prompt, /Georgië/);
  assert.match(quizCard(seed, 0, 1, georgiaState, usPlaces, "nl").prompt, /de staat Georgia/);
  assert.equal(["Atlanta", "Augusta", "Columbus"].includes(countryCity.correct), false);
  assert.notEqual(stateCity.correct, "Batumi");
}
const unitedStates = worldPlaces.find((place) => place.name === "United States");
assert.ok(unitedStates);
const usCity = quizCard(1, 0, 1, unitedStates, worldPlaces);
assert.equal(usCity.correct, "New York");
for (const place of worldPlaces) {
  const first = quizCard(4, 0, 0, place, worldPlaces);
  const second = quizCard(4, 0, 1, place, worldPlaces);
  assert.equal(second.choices.includes(first.correct), false, place.name);
  assert.ok(second.correct.length > 0, place.name);
  assert.ok(second.choices.includes(second.correct), place.name);
  assert.equal(second.choices.length, 3, place.name);
  assert.equal(new Set(second.choices).size, 3, place.name);
}
function landFrame(file: string) {
  const collection = JSON.parse(readFileSync(new URL(`../public/land/${file}`, import.meta.url), "utf8")) as FeatureCollection<LandFeature>;
  const bounds = boundsOf(settleDateline(collection).features);
  assert.ok(bounds, file);
  return { width: bounds[1][0] - bounds[0][0], west: bounds[0][0] };
}
const asiaFrame = landFrame("asia.geojson");
assert.ok(asiaFrame.width < 200 && asiaFrame.west > 10, `asia frame ${asiaFrame.west} ${asiaFrame.width}`);
const oceaniaFrame = landFrame("oceania.geojson");
assert.ok(oceaniaFrame.width < 120 && oceaniaFrame.west > 100, `oceania frame ${oceaniaFrame.west} ${oceaniaFrame.width}`);

const detailedNetherlands = JSON.parse(
  readFileSync(new URL("../public/land/netherlands.geojson", import.meta.url), "utf8"),
) as FeatureCollection<LandFeature>;
rememberLand(detailedNetherlands.features);
assert.equal(drawnCountryAt([6.89, 52.22]), "Netherlands");
assert.equal(sameCountry("Netherlands", "The Netherlands"), true);

const shown = quizCard(quiz.seed ?? 0, quiz.roundIndex, 0, getPlace(quiz.cityIds[0]!), quizPool(quiz.region), quiz.locale, {
  category: quiz.questionCategory,
  difficulty: quiz.mapDifficulty,
  placeMode: quiz.placeMode,
  region: quiz.region,
});
quiz = reducer(quiz, { type: "QUIZ_CHOOSE", choice: shown.correct });
const france = worldPlaces.find((place) => place.name === "France");
assert.ok(france);
const franceCountry = quizCard(3, 0, 0, france, worldPlaces, "en", {
  category: "landmarks",
  difficulty: "kids",
  placeMode: "countries",
  region: "world",
});
const franceCity = quizCard(3, 0, 0, france, worldPlaces, "nl", {
  category: "landmarks",
  difficulty: "kids",
  placeMode: "capitals",
  region: "world",
});
assert.match(franceCountry.prompt, /Eiffel Tower/);
assert.equal(franceCountry.correct, "France");
assert.match(franceCity.prompt, /Eiffeltoren/);
assert.equal(franceCity.correct, "Parijs");
const drenthe = placesFor("netherlands", "provinces").find((place) => place.name === "Drenthe");
assert.ok(drenthe);
const hunebedden = quizCard(2, 0, 0, drenthe, placesFor("netherlands", "provinces"), "en", {
  category: "landmarks",
  difficulty: "kids",
  placeMode: "provinces",
  region: "netherlands",
});
assert.match(hunebedden.prompt, /hunebedden/);
assert.equal(hunebedden.correct, "Drenthe");
const africaLand = JSON.parse(
  readFileSync(new URL("../public/land/africa.geojson", import.meta.url), "utf8"),
) as FeatureCollection<LandFeature>;
rememberLand(africaLand.features);
const mozambique = getPlace("africa:country:maputo");
const egyptPin: [number, number] = [29.233394217534197, 26.705097012993065];
const angolaPin: [number, number] = [16.42610804690645, -12.989271483923162];
const maputoTarget = revealPlace(mozambique, 3);
const egyptEnd = lineEndpoint(maputoTarget, egyptPin);
const angolaEnd = lineEndpoint(maputoTarget, angolaPin);
assert.ok(egyptEnd && angolaEnd);
assert.deepEqual(egyptEnd, maputoTarget.coordinates);
assert.deepEqual(angolaEnd, maputoTarget.coordinates);
assert.ok(Math.abs(haversineKm(egyptPin, egyptEnd) - 5868) < 1, "Egypt to Maputo is the 5,868 km in the bar");
const egyptLine = greatCircleSegments(egyptPin, egyptEnd).flat();
assert.deepEqual(egyptLine[0], egyptPin);
assert.deepEqual(egyptLine[egyptLine.length - 1], maputoTarget.coordinates);
assert.ok((egyptLine[1]?.[1] ?? 0) < egyptPin[1], "the line leaves Egypt toward the south, not the sea to the north");
const countryEnd = lineEndpoint(revealPlace(mozambique, 2), egyptPin);
assert.ok(countryEnd);
assert.notDeepEqual(countryEnd, maputoTarget.coordinates);
assert.ok(countryEnd[1] < 0, "a missed country line ends on Mozambique, south of the equator");
assert.equal(lineEndpoint(drenthe, [6.5, 53]), null, "a province click draws no line");

assert.equal(quiz.phase, "QUIZ_FEEDBACK");
assert.equal(quiz.quizCorrect, true);
assert.equal(quiz.quizPoints, 1000);

console.log(
  `engine ok · ${CITIES.length} cities · Netherlands ${netherlands.capitals.length}/${netherlands.provinces.length}/${netherlands.topCities.length} · Paris-London ${parisLondon.toFixed(1)} km`,
);
