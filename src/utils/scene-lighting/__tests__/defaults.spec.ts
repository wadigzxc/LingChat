import { expect, it } from "vitest";
import { lighting } from "@/test/scene-lighting-fixtures";
import { createNeutralLighting } from "../defaults";

it("creates independent neutral V2 defaults matching Rust", () => {
  const first = createNeutralLighting();
  expect(first).toEqual(lighting());
  first.character.brightness = 2;
  first.main_light.x = 0;
  expect(createNeutralLighting()).toEqual(lighting());
  expect(first.background.brightness).toBe(1);
});
