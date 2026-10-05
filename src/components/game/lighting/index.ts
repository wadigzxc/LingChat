import type { LightingAssetLayer } from "@/types/scene-lighting";

/** Host supplies verified URLs from its resource cache; null/undefined omit missing assets. */
export type LightingAssetResolver = (layer: LightingAssetLayer) => string | null | undefined;

export { default as LightingOverlay } from "./LightingOverlay.vue";
export { default as LightingAssetStack } from "./LightingAssetStack.vue";
export { default as StaticCharacterLightingFrame } from "./StaticCharacterLightingFrame.vue";
export { default as FinalLightingOverlay } from "./FinalLightingOverlay.vue";
