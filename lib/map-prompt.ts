import { getPlace } from "@/data/catalog";
import { fill, localPlaceName, messages, type LocaleId } from "@/lib/i18n";

export function mapPrompt(locale: LocaleId, cityId: string, step: 0 | 1 | 2 | 3): string {
  const city = getPlace(cityId);
  const text = messages(locale);
  const kind =
    step === 3
      ? "city"
      : city.id.startsWith("united-states:province:")
        ? "state"
        : city.id.includes(":province:")
          ? "province"
          : city.id.includes(":country:")
            ? "country"
            : "city";
  const name =
    kind === "city"
      ? (city.capitalName ?? city.name)
      : kind === "country"
        ? localPlaceName(locale, city.name)
        : city.name;
  if (kind === "province") return fill(text.whereIsProvince, { name });
  if (kind === "state") return fill(text.whereIsState, { name });
  if (kind === "country") return fill(text.whereIsCountry, { name });
  return fill(text.whereIsCity, { name });
}
