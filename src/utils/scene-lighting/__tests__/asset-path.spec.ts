import { expect, it } from "vitest";
import type { ResolvedLightingAsset } from "@/types/scene-lighting";
import { resolvedLightingAssetPath } from "../asset-path";
import { unsafeLightingAssetPaths } from "./asset-path-cases";

const hash = "a".repeat(64);
const dto = (path: string | null): ResolvedLightingAsset => ({
  hash,
  supported: true,
  asset_protocol_path: path,
  warning: null,
});
it.each(unsafeLightingAssetPaths)("rejects unsafe or malformed native paths: %j", (path) => {
  expect(resolvedLightingAssetPath(dto(path), hash)).toBeNull();
});

it.each([
  ["C:/光影 assets/a.png", "C:/光影 assets/a.png"],
  ["c:\\光影 assets\\a.png", "c:/光影 assets/a.png"],
  ["\\\\?\\C:\\光影 assets\\a.png", "C:/光影 assets/a.png"],
  [
    "\\\\?\\c:\\" + "long-path/".repeat(40).replace(/\//g, "\\") + "a.png",
    "c:/" + "long-path/".repeat(40) + "a.png",
  ],
  ["/home/光影 assets/a.png", "/home/光影 assets/a.png"],
  ["/home/assets/a #%.png", "/home/assets/a #%.png"],
])("normalizes supported absolute native paths: %j", (path, normalized) => {
  expect(resolvedLightingAssetPath(dto(path), hash)).toBe(normalized);
});

it.each([
  null,
  dto(null),
  { ...dto("C:/a.png"), hash: "b".repeat(64) },
  { ...dto("C:/a.png"), supported: false },
  { ...dto("C:/a.png"), warning: "missing asset" },
])("requires a supported hash-matching warning-free native DTO: %j", (result) => {
  expect(resolvedLightingAssetPath(result, hash)).toBeNull();
});
