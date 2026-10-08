import { distance, greatCircle, point } from "@turf/turf";

export const PREVIEW_MS = 0;
export const GUESS_MS = 8000;
export const RESULT_MS = 5000;
export const ROUNDS = 10;

export const COLOR = {
  player: "#c46a32",
  opponent: "#1d6e64",
  target: "#1d6e64",
  capital: "#2f4a52",
} as const;

export function haversineKm(a: [number, number], b: [number, number]): number {
  return distance(point(a), point(b), { units: "kilometers" });
}

export function scoreFromDistance(distanceKm: number, timeRemaining: number) {
  const distanceScore = Math.max(0, Math.round(5000 * Math.exp(-distanceKm / 2000)));
  const clampedTime = Math.max(0, Math.min(8, timeRemaining));
  const timeBonus = distanceScore > 1000 ? Math.round(1000 * (clampedTime / 8)) : 0;
  return {
    distanceScore,
    timeBonus,
    total: distanceScore + timeBonus,
  };
}

export function emptyScore() {
  return { distanceKm: null as number | null, distanceScore: 0, timeBonus: 0, total: 0 };
}

type LngLat = [number, number];

function splitAntimeridian(coords: LngLat[]): LngLat[][] {
  const segments: LngLat[][] = [];
  let current: LngLat[] = [];
  for (const coord of coords) {
    const prev = current[current.length - 1];
    if (prev && Math.abs(coord[0] - prev[0]) > 180) {
      if (current.length > 1) segments.push(current);
      current = [coord];
    } else {
      current.push(coord);
    }
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

export function greatCircleSegments(from: LngLat, to: LngLat): LngLat[][] {
  if (haversineKm(from, to) < 1) return [];
  const feature = greatCircle(point(from), point(to), { npoints: 96 });
  const geometry = feature.geometry;
  if (!geometry) return [];
  let segments: LngLat[][] = [];
  if (geometry.type === "LineString") {
    segments = splitAntimeridian(geometry.coordinates as LngLat[]);
  } else if (geometry.type === "MultiLineString") {
    segments = (geometry.coordinates as LngLat[][]).flatMap((line) => splitAntimeridian(line));
  }
  const head = segments[0];
  const tail = segments[segments.length - 1];
  if (head && head.length > 0) head[0] = [from[0], from[1]];
  if (tail && tail.length > 0) tail[tail.length - 1] = [to[0], to[1]];
  return segments;
}

export function formatKm(distanceKm: number | null): string {
  if (distanceKm == null) return "—";
  if (distanceKm < 10) return `${distanceKm.toFixed(1)} km`;
  return `${Math.round(distanceKm).toLocaleString("en-US")} km`;
}

export function formatScore(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}
