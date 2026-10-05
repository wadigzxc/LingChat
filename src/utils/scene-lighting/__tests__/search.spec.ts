import { expect, it } from "vitest";
import { matchesLightingPreset } from "../search";

it("searches displayed name, aliases, tags and description with case insensitive English and Chinese substrings", () => {
  const preset = {
    name: "Moonlight 月夜",
    aliases: ["Cold Backlight"],
    tags: ["CINEMATIC", "逆光"],
    description: "室内柔光 soft mood",
  };
  for (const query of ["moonLIGHT", "  BACKlight  ", "cinematic", "SOFT", "月", "柔光", "逆光", ""])
    expect(matchesLightingPreset(preset, query)).toBe(true);
  expect(matchesLightingPreset(preset, "warm")).toBe(false);
  expect(matchesLightingPreset(preset, "translated", "Translated Name")).toBe(true);
  expect(matchesLightingPreset(preset, "Moonlight", "Translated Name")).toBe(true);
});
