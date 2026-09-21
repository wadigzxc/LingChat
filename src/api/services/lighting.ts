import { invoke } from "@tauri-apps/api/core";
import type { LightingParams } from "./scene";

/** 预设元信息 + 完整参数（后端 lighting_store 是唯一真源）。 */
export interface LightingPreset {
  id: string;
  name: string;
  description: string;
  /** 适用心情关键词，供搜索 / LLM 匹配 */
  mood: string[];
  params: LightingParams;
  /** true = 用户自建（「我的预设」），可编辑可删除；内置预设不可改 */
  custom: boolean;
}

/** `lighting:change` / `script:lighting` 的负载，字段名与 Rust 的 camelCase 一致。 */
export interface LightingChangePayload {
  preset: string | null;
  /** null = 清除覆盖，回到「跟随场景」 */
  params: LightingParams | null;
  source: string;
  duration?: number;
}

export interface LightingState {
  /** Rust 侧是 camelCase（LightingState 结构体） */
  overrideParams: LightingParams | null;
  overridePreset: string | null;
  overrideSource: string;
  /** 前端上报回来的「屏幕实际渲染」状态，后端只存不判 */
  activePreset: string | null;
  activeSource: string;
  currentSceneId: string | null;
}

export async function listLightingPresets(): Promise<LightingPreset[]> {
  return invoke<LightingPreset[]>("lighting_list_presets");
}

export async function applyLighting(req: {
  preset?: string | null;
  params?: LightingParams | null;
}): Promise<LightingChangePayload> {
  return invoke<LightingChangePayload>("lighting_apply", { req });
}

export async function clearLighting(): Promise<void> {
  await invoke("lighting_clear");
}

export async function getLighting(): Promise<LightingState> {
  return invoke<LightingState>("lighting_get");
}

/**
 * 上报「屏幕上正在渲染的光影」给后端。
 *
 * 后端自己算不出来：设置面板选的全局预设存在 localStorage，渲染优先级又排在
 * 运行时覆盖之后。不回报的话 `lighting_get` 只能看见覆盖，模型会误判成
 * 「没打灯」或沿用上一次的结果，从而跳过用户要求的切换。
 */
export async function reportLightingActive(req: {
  preset?: string | null;
  source: string;
}): Promise<void> {
  await invoke("lighting_report_active", { req });
}

/** 保存自建预设的入参。`replaceId` 有值即覆盖同名自建预设（编辑后保存）。 */
export interface SaveLightingPresetReq {
  name: string;
  description?: string;
  mood?: string[];
  params: LightingParams;
  replaceId?: string | null;
}

export async function saveLightingPreset(req: SaveLightingPresetReq): Promise<LightingPreset> {
  return invoke<LightingPreset>("lighting_preset_save", {
    req: {
      name: req.name,
      description: req.description ?? "",
      mood: req.mood ?? [],
      params: req.params,
      replaceId: req.replaceId ?? null,
    },
  });
}

export async function deleteLightingPreset(id: string): Promise<void> {
  await invoke("lighting_preset_delete", { id });
}

// ===== 导出当前场景图和角色立绘给 Photoshop =====

/** 一张图的导出结果。逐张报，所以背景失败不会连累立绘。 */
export interface SourceExportOutcome {
  name: string;
  /** 写出去的文件完整路径；失败为 null */
  saved: string | null;
  error: string | null;
  /** 带透明的图存成 JPG 时后端按白底压平，面板要提醒一句 */
  alphaFlattened: boolean;
}

/**
 * 把软件正在用的原图另存成 PNG / JPG，作为 Photoshop 里的调色底稿。
 *
 * 只导原图：软件里的背景滤镜和光效层是叠在原图上的，拿屏幕截图当底稿会二次叠加，
 * 越调越偏。
 */
export async function exportLightingSources(req: {
  outDir: string;
  items: { path: string; name: string }[];
  format: "png" | "jpg";
}): Promise<SourceExportOutcome[]> {
  return invoke<SourceExportOutcome[]>("lighting_export_source", { req });
}
