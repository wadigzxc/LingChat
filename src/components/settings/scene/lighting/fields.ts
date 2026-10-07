import type { LightingParams } from "@/types/scene-lighting";
import { normalizeLighting } from "@/utils/scene-lighting/normalize";
export interface LightingField {
  path: string;
  label: string;
  type: "range" | "checkbox" | "text" | "select";
  min?: number;
  max?: number;
  step?: number;
  options?: readonly string[];
}
export const range = (
  path: string,
  label: string,
  min = 0,
  max = 1,
  step = 0.01
): LightingField => ({ path, label, type: "range", min, max, step });
export const toggle = (path: string, label: string): LightingField => ({
  path,
  label,
  type: "checkbox",
});
export const color = (path: string, label: string): LightingField => ({
  path,
  label,
  type: "text",
});
export const select = (path: string, label: string, options: readonly string[]): LightingField => ({
  path,
  label,
  type: "select",
  options,
});
export const targets = ["character", "background", "both"];
export const blends = ["normal", "screen", "add", "overlay", "soft_light", "multiply"];
export function readField(lighting: LightingParams, path: string): string | number | boolean {
  return path
    .split(".")
    .reduce((object, key) => (object as Record<string, unknown>)[key], lighting as unknown) as
    | string
    | number
    | boolean;
}
export function updateField(
  lighting: LightingParams,
  path: string,
  value: string | number | boolean
): LightingParams {
  const copy = JSON.parse(JSON.stringify(lighting)) as LightingParams;
  const keys = path.split(".");
  let object = copy as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) object = object[key] as Record<string, unknown>;
  object[keys[keys.length - 1]!] = value;
  if (lighting.link_character_background && keys.length === 2) {
    const peers: Record<string, string> = {
      character: "background",
      background: "character",
      character_ambient: "background_ambient",
      background_ambient: "character_ambient",
    };
    const peer = peers[keys[0]!];
    if (peer) (copy as unknown as Record<string, Record<string, unknown>>)[peer]![keys[1]!] = value;
  }
  return normalizeLighting(copy);
}
