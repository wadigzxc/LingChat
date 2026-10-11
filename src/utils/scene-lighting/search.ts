import type { LightingPreset } from "@/types/scene-lighting";

type SearchablePreset = Pick<
  LightingPreset,
  "name" | "aliases" | "tags" | "description" | "category"
>;

/** Localized display fields come from the host; raw hidden metadata stays searchable. */
export function matchesLightingPreset(
  preset: Readonly<SearchablePreset>,
  query: string,
  displayName?: string,
  displayMetadata: readonly string[] = []
): boolean {
  const needle = query.trim().toLowerCase();
  return (
    !needle ||
    [
      preset.name,
      displayName ?? "",
      ...displayMetadata,
      ...preset.aliases,
      ...preset.tags,
      preset.description,
      preset.category,
    ].some((value) => value.toLowerCase().includes(needle))
  );
}
