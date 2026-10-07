import { isMobile } from "@/utils/platform";
import { i18n } from "@/locales";
import { useUIStore } from "@/stores/modules/ui/ui";
import type { LightingParams } from "@/types/scene-lighting";

let mobileAssetsWarned = false;
/** Presentation projection only: never remove assets from a scene/runtime/draft snapshot. */
export function lightingForPlatform<T extends LightingParams | null>(lighting: T): T {
  return isMobile() && lighting ? { ...lighting, asset_layers: [] } : lighting;
}
/** One nonblocking notice per WebView, shared by runtime and editor scopes. */
export function notifySkippedLightingAssets(lighting: LightingParams | null) {
  if (!isMobile() || !lighting?.asset_layers.length || mobileAssetsWarned) return;
  mobileAssetsWarned = true;
  useUIStore().showNotification({
    type: "info",
    title: i18n.global.t("ui.lighting.mobileAssetsTitle"),
    message: i18n.global.t("ui.lighting.mobileAssetsMessage"),
    duration: 3000,
  });
}
