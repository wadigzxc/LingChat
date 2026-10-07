import { ref, reactive, watch, onScopeDispose, type Ref } from "vue";
import { convertFileSrc } from "@tauri-apps/api/core";
import { resolveLightingAsset } from "@/api/services/scene-lighting";
import type { LightingParams, LightingAssetLayer } from "@/types/scene-lighting";
/** Draft-scoped resolver: no runtime stores or global resource cache. */
export function useDraftLightingAssets(lighting: Readonly<Ref<LightingParams>>) {
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
    async (input) => {
      const current = ++sequence;
      urls.clear();
      warnings.value = [];
      if (!input.enabled) return;
      for (const layer of input.asset_layers) {
        if (!/^[a-f0-9]{64}$/.test(layer.asset_hash)) {
          warnings.value.push(`${layer.id}: 素材SHA-256格式无效`);
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
        const path = result?.asset_protocol_path;
        if (
          result?.hash === layer.asset_hash &&
          result.supported &&
          !result.warning &&
          path &&
          /^(?:[a-zA-Z]:[\\/]|\/(?!\/))/.test(path) &&
          !path.split(/[\\/]/).includes("..")
        ) {
          try {
            const url = convertFileSrc(path);
            cache.set(layer.asset_hash, url);
            urls.set(layer.asset_hash, url);
          } catch (error) {
            warnings.value.push(`${layer.id}: ${String(error)}`);
          }
        } else {
          warnings.value.push(
            `${layer.id}: ${failure || result?.warning || "素材不可解析或路径不安全"}`
          );
        }
      }
    },
    { immediate: true, deep: true }
  );
  return { warnings, resolveAsset: (layer: LightingAssetLayer) => urls.get(layer.asset_hash) };
}
