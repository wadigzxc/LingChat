import type { LightingPreset } from "@/types/scene-lighting";

type SearchablePreset = Pick<LightingPreset, "name" | "aliases" | "tags" | "description">;

/** Display name is provided by the i18n host; no locale/store dependencies here. */
export function matchesLightingPreset(
  preset: Readonly<SearchablePreset>,
  query: string,
  displayName?: string
): boolean {
  const needle = query.trim().toLowerCase();
  return (
    !needle ||
    [preset.name, displayName ?? "", ...preset.aliases, ...preset.tags, preset.description].some(
      (value) => value.toLowerCase().includes(needle)
    )
  );
}
