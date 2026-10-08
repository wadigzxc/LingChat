import { computed, reactive, watch, onScopeDispose, inject, provide, type InjectionKey } from "vue";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveLightingAsset } from "@/api/services/scene-lighting";
import { useGameStore } from "@/stores/modules/game";
import { useSettingsStore } from "@/stores/modules/settings";
import type { LightingAssetLayer } from "@/types/scene-lighting";
import { normalizeLighting } from "@/utils/scene-lighting/normalize";
import { resolvedLightingAssetPath } from "@/utils/scene-lighting/asset-path";
import {
  lightingForPlatform,
  notifySkippedLightingAssets,
} from "@/utils/scene-lighting/capabilities";

import { compileLighting } from "@/utils/scene-lighting/style";
import { useUIStore } from "@/stores/modules/ui/ui";
import { i18n } from "@/locales";
let addBlendWarned = false;
const sceneLightingKey: InjectionKey<ReturnType<typeof createSceneLighting>> =
  Symbol("scene-lighting");
export function provideSceneLighting() {
  const context = createSceneLighting();
  provide(sceneLightingKey, context);
  return context;
}
export function useSceneLighting() {
  return inject(sceneLightingKey, null) ?? createSceneLighting();
}
function createSceneLighting() {
  const game = useGameStore();
  const settings = useSettingsStore();
  const sourceLighting = computed(() => game.activeLighting);
  const lighting = computed(() => lightingForPlatform(sourceLighting.value));
  const simplified = computed(() => settings.display.simplifiedLighting);
  const urls = reactive(new Map<string, string>());
  const cache = new Map<string, string>();
  const pending = new Map<string, ReturnType<typeof resolveLightingAsset>>();
  const options = {
    supportsPlusLighter:
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("mix-blend-mode", "plus-lighter"),
  };
  const ui = useUIStore();
  watch(
    [sourceLighting, simplified],
    () => {
      // Warn from the unmodified snapshot before quality reduction hides its assets.
      notifySkippedLightingAssets(sourceLighting.value);
      const input = normalizeLighting(lighting.value);
      if (simplified.value) {
        input.asset_layers = [];
        input.bloom.enabled = false;
      }
      if (
        !addBlendWarned &&
        (["background", "character", "both"] as const).some(
          (surface) => compileLighting(input, surface, options).warnings.length
        )
      ) {
        addBlendWarned = true;
        ui.showNotification({
          type: "warning",
          title: i18n.global.t("ui.lighting.compatTitle"),
          message: i18n.global.t("ui.lighting.compatMessage"),
        });
      }
    },
    { immediate: true, deep: true }
  );
  let sequence = 0;
  onScopeDispose(() => {
    sequence++;
    urls.clear();
  });
  watch(
    [lighting, simplified],
    async () => {
      const current = ++sequence;
      urls.clear();
      const input = normalizeLighting(lighting.value);
      if (!input.enabled || simplified.value) return;
      for (const layer of input.asset_layers) {
        if (!/^[a-f0-9]{64}$/.test(layer.asset_hash)) continue;
        const cached = cache.get(layer.asset_hash);
        if (cached) {
          urls.set(layer.asset_hash, cached);
          continue;
        }
        let request = pending.get(layer.asset_hash);
        if (!request) {
          request = resolveLightingAsset(layer.asset_hash);
          pending.set(layer.asset_hash, request);
        }
        const result = await request.catch(() => null);
        pending.delete(layer.asset_hash);
        if (current !== sequence) return;
        if (!result) continue;
        const path = resolvedLightingAssetPath(result, layer.asset_hash);
        if (path) {
          try {
            const url = convertFileSrc(path);
            cache.set(layer.asset_hash, url);
            urls.set(layer.asset_hash, url);
          } catch {
            /* Missing protocol support must not block parameter lighting. */
          }
        }
      }
    },
    { immediate: true, deep: true }
  );
  return {
    lighting,
    simplified,
    options,
    resolveAsset: (layer: LightingAssetLayer) => urls.get(layer.asset_hash),
  };
}
