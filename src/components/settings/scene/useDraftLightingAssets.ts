import { useI18n } from "vue-i18n";
import { computed, ref, reactive, watch, onScopeDispose, type Ref } from "vue";
import {
  lightingForPlatform,
  notifySkippedLightingAssets,
} from "@/utils/scene-lighting/capabilities";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolvedLightingAssetPath } from "@/utils/scene-lighting/asset-path";
import { resolveLightingAsset } from "@/api/services/scene-lighting";
import type { LightingParams, LightingAssetLayer } from "@/types/scene-lighting";
/** Draft-scoped resolver: no runtime stores or global resource cache. */
export function useDraftLightingAssets(lighting: Readonly<Ref<LightingParams>>) {
  const { t } = useI18n();
  const renderedLighting = computed(() => lightingForPlatform(lighting.value));
  const urls = reactive(new Map<string, string>());
  const cache = new Map<string, string>();
  const pending = new Map<string, ReturnType<typeof resolveLightingAsset>>();
  const warnings = ref<string[]>([]);
  let sequence = 0;
  onScopeDispose(() => {
    sequence++;
    urls.clear();
  });
  watch(
    lighting,
    async (source) => {
      notifySkippedLightingAssets(source);
      const input = lightingForPlatform(source);
      const current = ++sequence;
      urls.clear();
      warnings.value = [];
      if (!input.enabled) return;
      for (const layer of input.asset_layers) {
        if (!/^[a-f0-9]{64}$/.test(layer.asset_hash)) {
          warnings.value.push(t("ui.lighting.invalidAssetHash", { id: layer.id }));
          continue;
        }
        const cached = cache.get(layer.asset_hash);
        if (cached) {
          urls.set(layer.asset_hash, cached);
          continue;
        }
        let failure = "";
        let request = pending.get(layer.asset_hash);
        if (!request) {
          request = resolveLightingAsset(layer.asset_hash);
          pending.set(layer.asset_hash, request);
        }
        const result = await request.catch((error) => {
          failure = String(error instanceof Error ? error.message : error);
          return null;
        });
        pending.delete(layer.asset_hash);
        if (current !== sequence) return;
        const path = resolvedLightingAssetPath(result, layer.asset_hash);
        if (path) {
          try {
            const url = convertFileSrc(path);
            cache.set(layer.asset_hash, url);
            urls.set(layer.asset_hash, url);
          } catch (error) {
            warnings.value.push(`${layer.id}: ${String(error)}`);
          }
        } else {
          warnings.value.push(
            `${layer.id}: ${failure || result?.warning || t("ui.lighting.assetUnavailable")}`
          );
        }
      }
    },
    { immediate: true, deep: true }
  );
  return {
    lighting: renderedLighting,
    warnings,
    resolveAsset: (layer: LightingAssetLayer) => urls.get(layer.asset_hash),
  };
}
