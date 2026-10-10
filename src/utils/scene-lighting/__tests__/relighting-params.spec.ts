import { expect, it } from "vitest";
import wireCases from "./relighting-wire-cases.json";
import { normalizeLighting } from "../normalize";

it("materializes an explicitly supplied empty relighting block with field defaults", () => {
  const input = { schema_version: 2, relighting: {} };
  expect(normalizeLighting(input)).toMatchObject({ relighting: wireCases.factory });
  expect(input).toEqual({ schema_version: 2, relighting: {} });
});

it("preserves explicit false while missing point enabled defaults to true", () => {
  const row = wireCases.cases.find((entry) => entry.id === "explicit-point-false")!;
  expect(normalizeLighting(row.input).relighting).toEqual(row.expected_relighting);
  expect(normalizeLighting({ relighting: { enabled: true } }).relighting?.point_light.enabled).toBe(
    true
  );
});

it("retains a canonical complete relighting snapshot without aliasing the input", () => {
  const row = wireCases.cases.find((entry) => entry.id === "canonical-relight-character")!;
  const before = JSON.parse(JSON.stringify(row.input));
  const result = normalizeLighting(row.input);
  expect(result.relighting).toEqual(row.expected_relighting);
  expect(row.input).toEqual(before);
  expect(result.relighting).not.toBe(row.input.relighting);
});

it("canonicalizes only opaque six-digit relighting colors independently of legacy colors", () => {
  const row = wireCases.cases.find((entry) => entry.id === "color-runtime-canonicalization")!;
  expect(normalizeLighting(row.input).relighting).toEqual(row.expected_relighting);
  expect(normalizeLighting({ character: { glow_color: "#ABCD" } }).character.glow_color).toBe(
    "#abcd"
  );
});

it("uses independent numerical bounds and field factory fallbacks for nonfinite values", () => {
  const row = wireCases.cases.find((entry) => entry.id === "runtime-clamps-not-archive")!;
  expect(normalizeLighting(row.input).relighting).toEqual(row.expected_relighting);
  expect(
    normalizeLighting({
      relighting: {
        ambient: { intensity: Infinity },
        point_light: { x: NaN, y: Infinity, radius: -Infinity, softness: NaN, intensity: Infinity },
      },
    }).relighting
  ).toEqual(wireCases.factory);
});

it("uses ECMAScript colour whitespace while retaining legacy colour acceptance", () => {
  const value = normalizeLighting({
    relighting: {
      ambient: { color: "\uFEFF#AABBCC\uFEFF" },
      point_light: { color: "#123456\u0085" },
    },
    character: { glow_color: "#ABCD" },
  });
  expect(value.relighting?.ambient.color).toBe("#aabbcc");
  expect(value.relighting?.point_light.color).toBe("#fff1d2");
  expect(value.character.glow_color).toBe("#abcd");
});
