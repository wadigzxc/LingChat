import { registerHandler, sendWebSocketChatMessage } from "..";
import { WebSocketMessageTypes } from "../../../types";
import { eventQueue } from "../../../core/events/event-queue";
import { useUserStore } from "../../../stores/modules/user/user";
import { useGameStore } from "../../../stores/modules/game";

import type * as ScriptTypes from "../../../types/script";
import type { SceneStateProjectionPayload } from "@/utils/scene-lighting/scene-state";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRevision(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function hasFields(
  value: unknown,
  numbers: string[],
  strings: string[],
  booleans: string[] = []
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    numbers.every((key) => typeof value[key] === "number" && Number.isFinite(value[key])) &&
    strings.every((key) => typeof value[key] === "string") &&
    booleans.every((key) => typeof value[key] === "boolean")
  );
}

function isLighting(value: unknown): boolean {
  if (
    !hasFields(value, ["master_intensity"], [], ["enabled", "link_character_background"]) ||
    value.schema_version !== 2
  )
    return false;
  const target = (v: unknown) => ["character", "background", "both"].includes(v as string);
  const blend = (v: unknown) =>
    ["screen", "add", "overlay", "soft_light", "multiply", "normal"].includes(v as string);
  const filter = (v: unknown) =>
    hasFields(v, ["brightness", "contrast", "saturation", "sepia", "glow_radius"], ["glow_color"]);
  const ambient = (v: unknown) => hasFields(v, ["opacity"], ["color"], ["enabled"]);
  const main = value.main_light;
  const bloom = value.bloom;
  return (
    filter(value.character) &&
    filter(value.background) &&
    ambient(value.character_ambient) &&
    ambient(value.background_ambient) &&
    hasFields(
      main,
      ["x", "y", "angle", "radius", "opacity"],
      ["color_start", "color_end"],
      ["enabled"]
    ) &&
    ["linear", "radial"].includes(main.shape as string) &&
    target(main.target) &&
    blend(main.blend_mode) &&
    hasFields(
      value.rim_light,
      ["intensity", "width", "softness", "angle", "offset"],
      ["color"],
      ["enabled"]
    ) &&
    hasFields(bloom, ["radius", "intensity"], ["color"], ["enabled"]) &&
    target(bloom.target) &&
    hasFields(value.vignette, ["intensity", "radius", "softness"], ["color"], ["enabled"]) &&
    Array.isArray(value.asset_layers) &&
    value.asset_layers.every(
      (layer) =>
        hasFields(
          layer,
          ["z_index", "opacity"],
          ["id", "asset_hash", "media_type"],
          ["required"]
        ) &&
        Number.isSafeInteger(layer.z_index) &&
        target(layer.target) &&
        blend(layer.blend_mode) &&
        ["front", "behind"].includes(layer.placement as string) &&
        ["contain", "stretch", "cover"].includes(layer.fit as string)
    )
  );
}

function isScene(value: unknown): boolean {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  const uiScene = "scene_name" in value;
  return (
    hasFields(
      value,
      [],
      [
        "id",
        uiScene ? "scene_name" : "name",
        uiScene ? "scene_description" : "description",
        "created_at",
        "updated_at",
      ],
      ["lighting_customized"]
    ) &&
    (uiScene ? nullableString(value.background) : typeof value.background === "string") &&
    (value.lighting === null || isLighting(value.lighting)) &&
    nullableString(value.lighting_preset_id) &&
    (value.lighting_preset_revision === null || isRevision(value.lighting_preset_revision)) &&
    (value.plugin_id === undefined || nullableString(value.plugin_id)) &&
    (!uiScene || typeof value.source === "string")
  );
}

function isCompleteSceneStatePayload(data: unknown): data is SceneStateProjectionPayload {
  if (!isRecord(data)) return false;
  return (
    isScene(data.scene) &&
    typeof data.background === "string" &&
    isLighting(data.active_lighting) &&
    ["neutral", "scene_default", "manual", "ai"].includes(data.source as string) &&
    nullableString(data.preset_id) &&
    (data.preset_revision === null || isRevision(data.preset_revision)) &&
    typeof data.customized === "boolean" &&
    isRevision(data.lighting_revision)
  );
}

/**
 * `scene_change` predates the revisioned Tauri scene event. New senders may provide the
 * complete payload and must use the same authoritative reducer; old senders only carry
 * `scene`, so they update the local projection without changing revision authority.
 */
export function applySceneChangeMessage(data: unknown): void {
  if (!data || typeof data !== "object") return;
  const gameStore = useGameStore();
  if (isCompleteSceneStatePayload(data)) {
    gameStore.applySceneState(data);
    return;
  }
  // A revision marker opts the sender into the authoritative payload contract. Never
  // reinterpret an incomplete revisioned message as legacy, because that would bypass
  // the reducer and partially mutate scene state without its matching lighting state.
  if ("lighting_revision" in data) return;
  const legacy = data as { scene?: unknown };
  if ("scene" in legacy) {
    gameStore.applyCurrentScene(
      (legacy.scene ?? null) as Parameters<typeof gameStore.applyCurrentScene>[0]
    );
  }
}

export class ScriptHandler {
  constructor() {
    this.registerHandlers();
  }

  private registerHandlers() {
    registerHandler(WebSocketMessageTypes.CONNECTION, (data: any) => {
      console.log("收到链接建立事件:", data);
      useUserStore().client_id = data.client_id; // 保存client_id
    });

    registerHandler(WebSocketMessageTypes.SCRIPT_NARRATION, (data: any) => {
      console.log("收到剧本旁白事件:", data);
      eventQueue.addEvent(data as ScriptTypes.ScriptNarrationEvent);
    });

    registerHandler(WebSocketMessageTypes.SCRIPT_DIALOGUE, (data: any) => {
      console.log("收到剧本对话事件:", data);
      eventQueue.addEvent(data as ScriptTypes.ScriptDialogueEvent);
    });

    registerHandler(WebSocketMessageTypes.SCRIPT_FREE_DIALOGUE, (data: any) => {
      console.log("收到自由剧本对话事件:", data);
      eventQueue.addEvent(data as ScriptTypes.ScriptFreeDialogueEvent);
    });

    registerHandler(WebSocketMessageTypes.SCRIPT_THINKING, (data: any) => {
      console.log("收到剧本思考事件:", data);
      eventQueue.addEvent(data as ScriptTypes.ScriptThinkingEvent);
    });

    registerHandler(WebSocketMessageTypes.SCRIPT_CHAPTER_CHANGE, (data: any) => {
      console.log("收到章节切换事件:", data);
      eventQueue.addEvent(data as ScriptTypes.ScriptChapterChangeEvent);
    });

    registerHandler(WebSocketMessageTypes.SCRIPT_BACKGROUND, (data: any) => {
      console.log("收到背景切换事件:", data);
      eventQueue.addEvent(data as ScriptTypes.ScriptBackgroundEvent);
    });

    registerHandler(WebSocketMessageTypes.SCRIPT_PLAYER, (data: any) => {
      console.log("收到主人公对话事件:", data);
      eventQueue.addEvent(data as ScriptTypes.ScriptPlayerEvent);
    });

    registerHandler(WebSocketMessageTypes.SCRIPT_MUSIC, (data: any) => {
      console.log("收到背景音乐切换事件:", data);
      eventQueue.addEvent(data as ScriptTypes.ScriptMusicEvent);
    });

    registerHandler(WebSocketMessageTypes.SCRIPT_BACKGROUND_EFFECT, (data: any) => {
      console.log("收到背景特效切换事件:", data);
      eventQueue.addEvent(data as ScriptTypes.ScriptBackgroundEffectEvent);
    });

    registerHandler(WebSocketMessageTypes.SCRIPT_PRESENT_PIC, (data: any) => {
      console.log("收到图片展示事件:", data);
      eventQueue.addEvent(data as ScriptTypes.ScriptPlayerEvent);
    });

    registerHandler(WebSocketMessageTypes.SCRIPT_SOUND, (data: any) => {
      console.log("收到音效切换事件:", data);
      eventQueue.addEvent(data as ScriptTypes.ScriptSoundEvent);
    });

    // 环境音事件（多轨并行，与BGM共存）
    registerHandler(WebSocketMessageTypes.SCRIPT_AMBIENT, (data: any) => {
      console.log("收到环境音事件:", data);
      eventQueue.addEvent(data as ScriptTypes.ScriptAmbientEvent);
    });

    registerHandler(WebSocketMessageTypes.SCRIPT_MODIFY_CHARACTER, (data: any) => {
      console.log("收到修改角色事件:", data);
      eventQueue.addEvent(data as ScriptTypes.ScriptModifyCharacterEvent);
    });

    registerHandler(WebSocketMessageTypes.SCRIPT_INPUT, (data: any) => {
      console.log("收到输入事件:", data);
      eventQueue.addEvent(data as ScriptTypes.ScriptInputEvent);
    });

    registerHandler(WebSocketMessageTypes.SCRIPT_CHOICE, (data: any) => {
      console.log("收到选择事件:", data);
      eventQueue.addEvent(data as ScriptTypes.ScriptChoiceEvent);
    });

    registerHandler(WebSocketMessageTypes.SCRIPT_END, (data: any) => {
      console.log("收到脚本结束事件:", data);
      eventQueue.addEvent(data as ScriptTypes.ScriptEndEvent);
    });

    // 错误事件 - 通过 eventQueue 统一处理
    registerHandler(WebSocketMessageTypes.ERROR, (data: any) => {
      console.log("收到错误消息:", data);
      eventQueue.addEvent({ ...data, type: "error", duration: 0 } as ScriptTypes.ScriptErrorEvent);
    });

    // 状态重置事件 - 通过 eventQueue 统一处理
    registerHandler("status_reset", (data: any) => {
      console.log("收到状态重置消息:", data);
      eventQueue.addEvent({
        ...data,
        type: "status_reset",
        duration: 0,
      } as ScriptTypes.ScriptStatusResetEvent);
    });

    // 场景切换事件
    registerHandler(WebSocketMessageTypes.SCENE_CHANGE, (data: any) => {
      console.log("收到场景切换事件:", data);
      applySceneChangeMessage(data);
    });
  }

  public sendMessage(text: string, instruction?: string) {
    if (!text.trim()) return;
    const message = instruction ? `${text}[!Temp!]${instruction}[/!Temp!]` : text;

    // 用户在任意位置输入 /开始剧本 时，也标记为剧情模式（用于隐藏番茄钟/日程等自由模式工具）
    if (text.trim().startsWith("/开始剧本")) {
      const parts = text.trim().split(/\s+/, 2);
      const scriptName = parts[1] || "default";
      useGameStore().enterStoryMode(scriptName);
    }

    sendWebSocketChatMessage(WebSocketMessageTypes.MESSAGE, message);
  }
}

// 导出单例
export const scriptHandler = new ScriptHandler();
