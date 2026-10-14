<template>
  <MenuPage>
    <!-- ========== 场景管理 ========== -->
    <MenuItem :title="lightingText('sceneSettingsTitle', '场景及光影设置')">
      <template #header>
        <PictureInPicture :size="20" />
      </template>

      <!-- 当前场景信息 + 操作按钮 -->
      <div class="mb-4 flex items-center gap-3">
        <div class="text-brand font-bold">
          {{ $t("settings.background.scene.current") }}{{ currentSceneDisplay }}
        </div>
        <div class="ml-auto flex gap-3">
          <button
            class="rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-white/80
              shadow-lg transition-all hover:bg-white/20 disabled:cursor-not-allowed
              disabled:opacity-40"
            :title="$t('settings.background.scene.refresh')"
            :disabled="refreshing"
            @click="handleRefreshScenes"
          >
            <RefreshCw :size="16" :class="refreshing ? 'animate-spin' : ''" />
          </button>
          <button
            class="bg-brand/80 border-brand hover:bg-brand rounded-full border px-5 py-1.5 text-sm
              font-bold text-white shadow-lg shadow-indigo-500/20 transition-all"
            @click="handleCreateScene"
          >
            {{ $t("settings.background.scene.create") }}
          </button>
          <button
            class="rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm font-bold
              text-white/80 shadow-lg transition-all hover:bg-white/20"
            :disabled="uploadingBackground"
            @click="triggerUpload"
          >
            {{ $t("settings.background.scene.upload") }}
          </button>
          <button
            v-if="!isAndroid()"
            class="rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-sm font-bold
              text-white/80 shadow-lg transition-all hover:bg-white/20"
            :disabled="openingFolder"
            @click="handleOpenFolder"
          >
            {{ $t("settings.background.scene.openFolder") }}
          </button>
          <button
            class="rounded-full border border-red-500/30 bg-red-500/20 px-4 py-1.5 text-sm font-bold
              text-red-300 shadow-lg transition-all hover:bg-red-500/30"
            :disabled="!currentScene || deletingScene"
            @click="handleDeleteScene"
          >
            {{ $t("settings.background.scene.delete") }}
          </button>
        </div>
      </div>

      <p data-active-lighting-status role="status" class="mb-3 text-sm text-white/80">
        {{ activeLightingStatus }}
      </p>
      <LightingQualityToggle class="mb-3 text-white" />
      <LightingPresetSelect
        :refresh-key="lightingPresetVersion"
        :active-preset-id="gameStore.activeLightingPresetId"
        @loaded="handlePresetsLoaded"
        @favorite-changed="lightingPresetVersion++"
      />
      <button
        data-save-scene-default
        :disabled="!canSaveSceneDefault || savingDefault"
        @click="handleSaveSceneDefault"
        class="my-3 rounded-lg border border-white/20 px-4 py-2 text-white disabled:opacity-40"
      >
        {{ lightingText("saveSceneDefault", "保存为当前场景默认") }}
      </button>
      <button
        data-manage-lighting
        class="my-3 rounded-lg border border-white/20 px-4 py-2 text-white"
        @click="showLightingManager = !showLightingManager"
      >
        {{
          showLightingManager
            ? lightingText("closeManager", "关闭预设管理器")
            : lightingText("manage", "管理光影预设")
        }}
      </button>
      <LightingPresetManager
        v-if="showLightingManager"
        :active-lighting="gameStore.activeLighting"
        :refresh-key="lightingPresetVersion"
        @changed="lightingPresetVersion++"
      />

      <!-- 场景卡片网格 -->
      <div class="grid w-full grid-cols-1 gap-5 pb-5 sm:grid-cols-2 xl:grid-cols-3">
        <div
          v-for="scene in paginatedScenes"
          :key="scene.id"
          :data-scene-card="scene.id"
          :aria-busy="selectingScene"
          :class="[
            `group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border
            border-white/12.5 bg-white/10
            shadow-[0_8px_32px_rgba(0,0,0,0.1),inset_0_1px_1px_rgba(255,255,255,0.1)]
            backdrop-blur-[20px] backdrop-saturate-180 transition-all duration-300
            hover:-translate-y-1 hover:scale-[1.01] hover:bg-white/15
            hover:shadow-[0_12px_40px_rgba(0,0,0,0.15),inset_0_2px_2px_rgba(255,255,255,0.15)]
            hover:backdrop-blur-[25px] hover:backdrop-saturate-200`,
            isSceneSelected(scene.id)
              ? `border-2! border-sky-400!
                shadow-[0_0_12px_rgba(56,189,248,0.5),0_0_3px_rgba(56,189,248,0.8),inset_0_0_8px_rgba(56,189,248,0.15)]`
              : '',
          ]"
          @click="handleSceneClick(scene)"
        >
          <!-- 编辑按钮（右上角扳手）—— 插件场景只读，不提供编辑 -->
          <button
            v-if="!scene.source || scene.source === 'game'"
            class="absolute top-2 right-2 z-10 rounded-lg bg-black/50 p-1.5 text-white/60 opacity-0
              transition-all group-hover:opacity-100 hover:bg-black/70 hover:text-white
              focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2
              focus-visible:outline-sky-300"
            @click.stop="handleWrenchClick(scene)"
            :title="$t('settings.background.scene.edit')"
          >
            <Wrench :size="16" />
          </button>
          <PluginTag
            v-if="scene.source && scene.source !== 'game'"
            :source="scene.source"
            class="absolute top-2 left-2 z-10"
          />

          <SceneCardLightingPreview
            :lighting="scene.lighting"
            :background="scene.background"
            :name="scene.scene_name"
            :simplified="settingsStore.display.simplifiedLighting"
          />

          <!-- 信息栏 -->
          <div
            class="relative z-2 flex flex-col gap-1 border-t border-white/20 bg-white/15 px-4 py-3
              backdrop-blur-[10px]"
          >
            <span data-card-lighting-label class="text-xs text-sky-200">{{
              sceneLightingLabel(scene)
            }}</span>
            <span class="truncate font-medium text-white/90 drop-shadow-md">
              {{ scene.scene_name }}
            </span>
            <span v-if="scene.scene_description" class="line-clamp-2 text-xs text-white/50">{{
              scene.scene_description
            }}</span>
            <span v-else class="text-xs text-yellow-400/60 italic">{{
              $t("settings.background.scene.noDescription")
            }}</span>
          </div>
        </div>
      </div>

      <!-- 分页控件 -->
      <div v-if="totalPages > 1" class="flex items-center justify-center gap-2 pb-2">
        <button
          :disabled="currentPage <= 1"
          @click="currentPage = 1"
          class="px-2 py-1 text-xs text-white/50 transition-colors hover:text-white
            disabled:cursor-not-allowed disabled:opacity-30"
        >
          {{ $t("settings.background.pagination.first") }}
        </button>
        <button
          :disabled="currentPage <= 1"
          @click="currentPage = currentPage - 1"
          class="px-3 py-1 text-sm text-white/50 transition-colors hover:text-white
            disabled:cursor-not-allowed disabled:opacity-30"
        >
          {{ $t("settings.shared.prevPage") }}
        </button>
        <span class="px-3 text-xs text-white/60">
          {{ $t("settings.shared.pageOf", { current: currentPage, total: totalPages }) }}
        </span>
        <button
          :disabled="currentPage >= totalPages"
          @click="currentPage = currentPage + 1"
          class="px-3 py-1 text-sm text-white/50 transition-colors hover:text-white
            disabled:cursor-not-allowed disabled:opacity-30"
        >
          {{ $t("settings.shared.nextPage") }}
        </button>
        <button
          :disabled="currentPage >= totalPages"
          @click="currentPage = totalPages"
          class="px-2 py-1 text-xs text-white/50 transition-colors hover:text-white
            disabled:cursor-not-allowed disabled:opacity-30"
        >
          {{ $t("settings.background.pagination.last") }}
        </button>
      </div>

      <!-- 隐藏的文件上传 input -->
      <input
        type="file"
        :disabled="uploadingBackground"
        ref="uploadInput"
        @change="handleFileUpload"
        accept=".jpg,.jpeg,.png,.webp,.bmp,.svg,.tif,.gif"
        style="display: none"
      />
    </MenuItem>

    <MenuItem :title="$t('settings.background.particle.title')" size="large">
      <template #header>
        <Sparkles :size="20" />
      </template>
      <div class="effect-list flex gap-4 overflow-x-auto pb-2">
        <Button type="big" :active="currentParticle === 'None'" @click="updateParticle(`None`)">{{
          $t("settings.background.particle.none")
        }}</Button>
        <Button
          type="big"
          :active="currentParticle === 'StarField'"
          @click="updateParticle(`StarField`)"
          >{{ $t("settings.background.particle.starField") }}</Button
        >
        <Button type="big" :active="currentParticle === 'Rain'" @click="updateParticle(`Rain`)">{{
          $t("settings.background.particle.rain")
        }}</Button>
        <Button
          type="big"
          :active="currentParticle === 'Sakura'"
          @click="updateParticle(`Sakura`)"
          >{{ $t("settings.background.particle.sakura") }}</Button
        >
        <Button type="big" :active="currentParticle === 'Snow'" @click="updateParticle(`Snow`)">{{
          $t("settings.background.particle.snow")
        }}</Button>
        <Button
          type="big"
          :active="currentParticle === 'Fireworks'"
          @click="updateParticle(`Fireworks`)"
          >{{ $t("settings.background.particle.fireworks") }}</Button
        >
      </div>
    </MenuItem>

    <MenuItem :title="$t('settings.background.animation.switchTitle')" size="large">
      <template #header>
        <Settings :size="20" />
      </template>
      <div class="flex flex-col gap-3">
        <Toggle
          :checked="mainMenuStarsEnabled"
          @change="settingsStore.setMainMenuStarsEnabled($event)"
        >
          {{ $t("settings.background.animation.mainMenuStars") }}
        </Toggle>
        <Toggle
          :checked="mainMenuMeteorsEnabled"
          @change="settingsStore.setMainMenuMeteorsEnabled($event)"
        >
          {{ $t("settings.background.animation.mainMenuMeteors") }}
        </Toggle>
        <Toggle
          :checked="globalMouseTrailEnabled"
          @change="settingsStore.setGlobalMouseTrailEnabled($event)"
        >
          {{ $t("settings.background.animation.mouseTrail") }}
        </Toggle>
        <Toggle
          :checked="clickAnimationEnabled"
          @change="settingsStore.setClickAnimationEnabled($event)"
        >
          {{ $t("settings.background.animation.clickAnimation") }}
        </Toggle>
        <Toggle
          :checked="sceneAwarenessEnabled"
          @change="settingsStore.setSceneAwarenessEnabled($event)"
        >
          {{ $t("settings.background.animation.sceneAwareness") }}
        </Toggle>
      </div>
    </MenuItem>

    <!-- HDR 模式（仅 Windows：WebView2 强制色彩配置在 HDR 下会发灰/发暗） -->
    <MenuItem v-if="isWindows()" :title="$t('settings.background.hdr.title')" size="large">
      <template #header>
        <Settings :size="20" />
      </template>
      <div class="flex flex-col gap-3">
        <Toggle :checked="hdrModeEnabled" @change="settingsStore.setHdrModeEnabled($event)">
          {{ $t("settings.background.hdr.enable") }}
        </Toggle>
        <p class="text-xs text-yellow-400/70">
          {{ $t("settings.background.hdr.restartHint") }}
        </p>
        <button
          class="self-start rounded-lg border border-amber-500/30 bg-amber-500/20 px-4 py-2 text-sm
            font-medium text-amber-300 transition-colors hover:bg-amber-500/30
            disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!hdrChanged"
          @click="restartApp"
        >
          {{ $t("settings.background.hdr.restartBtn") }}
        </button>
      </div>
    </MenuItem>

    <MenuItem :title="$t('settings.background.animation.settingsTitle')" size="large">
      <template #header>
        <Sparkles :size="20" />
      </template>
      <div class="flex flex-col gap-4 p-2">
        <div
          class="flex items-center gap-4 max-[640px]:flex-col max-[640px]:items-stretch
            max-[640px]:gap-2"
        >
          <span class="min-w-30 text-sm font-medium text-white/90">{{
            $t("settings.background.animation.meteorFps")
          }}</span>
          <Slider
            v-model="meteorFps"
            :min="10"
            :max="60"
            :step="5"
            accent-color="#8b5cf6"
            @change="handleMeteorFpsChange"
            class="flex-1"
          >
            <template #left>{{ meteorFps }} FPS</template>
          </Slider>
          <input
            type="number"
            v-model.number="meteorFpsInput"
            @blur="handleInputBlur"
            @keyup.enter="handleInputEnter"
            min="10"
            max="300"
            class="w-20 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm
              font-medium text-white transition-all focus:border-transparent focus:ring-2
              focus:ring-purple-500 focus:outline-none"
          />
        </div>

        <div
          class="flex items-center gap-4 max-[640px]:flex-col max-[640px]:items-stretch
            max-[640px]:gap-2"
        >
          <span class="min-w-30 text-sm font-medium text-white/90">{{
            $t("settings.background.animation.starsFps")
          }}</span>
          <Slider
            v-model="starsFps"
            :min="10"
            :max="60"
            :step="5"
            accent-color="#fbbf24"
            @change="handleStarsFpsChange"
            class="flex-1"
          >
            <template #left>{{ starsFps }} FPS</template>
          </Slider>
          <input
            type="number"
            v-model.number="starsFpsInput"
            @blur="handleStarsInputBlur"
            @keyup.enter="handleStarsInputEnter"
            min="10"
            max="300"
            class="w-20 rounded-lg border border-white/20 bg-white/10 px-3 py-1.5 text-sm
              font-medium text-white transition-all focus:border-transparent focus:ring-2
              focus:ring-yellow-500 focus:outline-none"
          />
        </div>
      </div>
    </MenuItem>

    <MenuItem :title="$t('settings.background.perf.title')" size="large">
      <template #header>
        <Cpu :size="20" />
      </template>
      <div class="flex flex-col gap-3">
        <!-- 加载中 -->
        <div v-if="perfLoading" class="flex items-center gap-2 text-sm text-white/60">
          <span
            class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/30
              border-t-white/80"
          ></span>
          {{ $t("settings.background.perf.detecting") }}
        </div>

        <!-- 检测结果 -->
        <div v-else-if="cpuInfo" class="flex flex-col gap-2">
          <!-- 未知 CPU 提示 -->
          <div
            v-if="cpuInfo.is_unknown && cpuInfo.unknown_message"
            class="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/15
              px-3 py-2 text-sm text-yellow-200"
          >
            <span>⚠️ {{ cpuInfo.unknown_message }}</span>
          </div>

          <!-- GPU 分级不适用 / 未检测到 GPU 提示 -->
          <div
            v-if="gpuInfo?.message"
            class="flex items-center gap-2 rounded-lg border border-yellow-500/30 bg-yellow-500/15
              px-3 py-2 text-sm text-yellow-200"
          >
            <span>⚠️ {{ gpuInfo.message }}</span>
          </div>

          <!-- CPU 行 -->
          <div class="flex items-center gap-2">
            <span class="min-w-16 shrink-0 text-xs font-medium text-white/50">{{
              $t("settings.background.perf.cpuName")
            }}</span>
            <span class="flex-1 font-mono text-sm break-all text-white/90">{{
              cpuInfo.brand
            }}</span>
            <span
              class="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold"
              :class="tierBadgeClassFor(cpuInfo.tier as PerfTier)"
              :style="{ backgroundColor: getPerfTierColor(cpuInfo.tier as PerfTier) + '99' }"
            >
              {{ getTierLabel(cpuInfo.tier as PerfTier) }}
            </span>
          </div>

          <!-- GPU 行（分级适用且有检测到 GPU 时显示） -->
          <div v-if="gpuInfo?.is_applicable && gpuInfo.name" class="flex items-center gap-2">
            <span class="min-w-16 shrink-0 text-xs font-medium text-white/50">{{
              $t("settings.background.perf.gpuName")
            }}</span>
            <span class="flex-1 font-mono text-sm break-all text-white/90">{{ gpuInfo.name }}</span>
            <span
              class="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold"
              :class="tierBadgeClassFor(gpuInfo.tier as PerfTier)"
              :style="{ backgroundColor: getPerfTierColor(gpuInfo.tier as PerfTier) + '99' }"
            >
              {{ getTierLabel(gpuInfo.tier as PerfTier) }}
            </span>
          </div>

          <!-- 当前实际调用的 GPU（WebGL 渲染器，反映程序真正在用的卡） -->
          <div v-if="activeGpu?.is_applicable && activeGpu.name" class="flex items-center gap-2">
            <span class="min-w-16 shrink-0 text-xs font-medium text-white/50">{{
              $t("settings.background.perf.activeGpuName")
            }}</span>
            <span class="flex-1 font-mono text-sm break-all text-white/90">{{
              activeGpu.name
            }}</span>
            <span
              class="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold"
              :class="tierBadgeClassFor(activeGpu.tier as PerfTier)"
              :style="{ backgroundColor: getPerfTierColor(activeGpu.tier as PerfTier) + '99' }"
            >
              {{ getTierLabel(activeGpu.tier as PerfTier) }}
            </span>
          </div>

          <!-- 综合等级（取最低） -->
          <div class="flex items-center gap-2">
            <span class="min-w-16 shrink-0 text-xs font-medium text-white/50">{{
              $t("settings.background.perf.combinedTier")
            }}</span>
            <span
              v-if="combinedTier"
              class="rounded-full px-2.5 py-0.5 text-xs font-bold"
              :class="tierBadgeClassFor(combinedTier)"
              :style="{ backgroundColor: getPerfTierColor(combinedTier) + '99' }"
            >
              {{ getTierLabel(combinedTier) }}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <span class="min-w-16 shrink-0 text-xs font-medium text-white/50">{{
              $t("settings.background.perf.suggestedFps")
            }}</span>
            <span class="text-sm text-white/70">{{ suggestedFps }} FPS</span>
          </div>
        </div>

        <!-- 错误状态 -->
        <div v-else-if="perfError" class="text-sm text-red-300">
          {{ perfError }}
        </div>

        <!-- 重新检测按钮（同时重新检测 CPU 与 GPU） -->
        <button
          class="bg-brand/80 border-brand hover:bg-brand mt-1 self-start rounded-full border px-4
            py-1.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/20 transition-all
            disabled:cursor-not-allowed disabled:opacity-40"
          :disabled="perfLoading"
          @click="handleRedetectPerf"
        >
          {{
            perfLoading
              ? $t("settings.background.perf.detectingShort")
              : $t("settings.background.perf.redetect")
          }}
        </button>
      </div>
    </MenuItem>

    <!-- ========== 对话框外观（自定义） ========== -->
    <MenuItem :title="$t('settings.background.dialog.title')" size="large">
      <template #header>
        <MessageSquare :size="20" />
      </template>
      <DialogAppearancePanel />
    </MenuItem>

    <SceneEditModal
      :show="showSceneEdit"
      :mode="editMode"
      :backgrounds="backgroundList"
      :initial-data="editInitialData"
      :lighting-preset-refresh-key="lightingPresetVersion"
      @favorite-changed="lightingPresetVersion++"
      @close="showSceneEdit = false"
      :scene-key="editingSceneId"
      :save-scene="handleSceneSubmit"
      @upload="triggerUpload"
    />
  </MenuPage>
</template>

<script setup lang="ts">
  import { ref, onMounted, watch, computed } from "vue";
  import { useI18n } from "vue-i18n";
  import { MenuPage, MenuItem } from "../../ui";
  import { Button, Toggle, Slider } from "../../base";
  import { useGameStore } from "../../../stores/modules/game";
  import { useUIStore } from "../../../stores/modules/ui/ui";
  import { useDialogStore } from "../../../stores/modules/ui/dialog";
  import { useSettingsStore } from "../../../stores/modules/settings";
  import { isAndroid, isWindows } from "@/utils/platform";
  import { relaunch } from "@tauri-apps/plugin-process";
  import {
    listScenes,
    createScene,
    updateScene,
    deleteScene,
    selectScene,
    getSceneLightingMetadata,
    type SceneInfo,
    type SceneLightingMetadata,
    type LightingParams,
    type UpdateSceneRequest,
  } from "../../../api/services/scene";
  import type { BackgroundImageInfo } from "../../../types";
  import {
    getBackgroundImages,
    uploadBackgroundImage,
    generateBackgroundImage,
    openBackgroundsFolder,
  } from "../../../api/services/background";
  import { unlockAchievement } from "../../../api/services/achievement";
  import {
    getCpuInfo,
    redetectCpu,
    getTierLabel,
    getSuggestedMaxFps,
    getPerfTierColor,
    getCombinedTier,
    type CpuInfo,
    type PerfTier,
  } from "../../../api/services/cpu-perf";
  import {
    getGpuInfo,
    redetectGpu,
    getActiveGpu,
    type GpuInfo,
  } from "../../../api/services/gpu-perf";
  import {
    PictureInPicture,
    Sparkles,
    Settings,
    Wand2,
    Wrench,
    Cpu,
    RefreshCw,
  } from "lucide-vue-next";
  import { useLightingOperation } from "../lighting/useLightingOperation";
  const { text: lightingText, presetName } = useLightingOperation();
  import type { LightingPreset } from "@/types/scene-lighting";
  const lightingPresets = ref<LightingPreset[]>([]);
  const presetsLoaded = ref(false);
  const handlePresetsLoaded = (presets: LightingPreset[]) => {
    lightingPresets.value = presets;
    presetsLoaded.value = true;
  };
  const lightingProvenance = (id: string | null, revision: number | null, customized: boolean) => {
    const preset = lightingPresets.value.find((p) => p.id === id);
    const name = preset ? presetName(preset) : (id ?? lightingText("custom", "自定义"));
    return [
      name,
      id && !preset && presetsLoaded.value ? lightingText("sourceDeleted", "来源已删除") : "",
      revision == null ? "" : `r${revision}`,
      customized ? lightingText("customized", "已自定义") : "",
    ]
      .filter(Boolean)
      .join(" · ");
  };
  const sceneLightingLabel = (scene: SceneInfo) =>
    !scene.lighting
      ? lightingText("neutral", "系统中性")
      : lightingProvenance(scene.lighting_preset_id, null, scene.lighting_customized);
  const activeLightingStatus = computed(() => {
    const source = gameStore.activeLightingSource;
    const state =
      source === "manual" || source === "ai"
        ? lightingText("temporary", "临时")
        : source === "scene_default"
          ? lightingText("sceneDefault", "场景默认")
          : lightingText("neutral", "系统中性");
    return `${state} · ${lightingProvenance(gameStore.activeLightingPresetId, gameStore.activeLightingPresetRevision, gameStore.activeLightingCustomized)}`;
  });
  import LightingPresetSelect from "../lighting/LightingPresetSelect.vue";
  import LightingQualityToggle from "../lighting/LightingQualityToggle.vue";
  import LightingPresetManager from "../lighting/LightingPresetManager.vue";
  const showLightingManager = ref(false);
  const lightingPresetVersion = ref(0);
  import SceneEditModal from "../scene/SceneEditModal.vue";
  import SceneCardLightingPreview from "../scene/SceneCardLightingPreview.vue";
  import DialogAppearancePanel from "../dialog/DialogAppearancePanel.vue";
  import PluginTag from "@/components/ui/PluginTag.vue";
  import { useUserStore } from "../../../stores/modules/user/user";

  const gameStore = useGameStore();
  const uiStore = useUIStore();
  const settingsStore = useSettingsStore();
  const userStore = useUserStore();
  const dialogStore = useDialogStore();
  const { t } = useI18n();

  const mainMenuStarsEnabled = computed(() => settingsStore.mainMenuStarsEnabled);
  const mainMenuMeteorsEnabled = computed(() => settingsStore.mainMenuMeteorsEnabled);
  const globalMouseTrailEnabled = computed(() => settingsStore.globalMouseTrailEnabled);
  const clickAnimationEnabled = computed(() => settingsStore.clickAnimationEnabled);
  const sceneAwarenessEnabled = computed(() => settingsStore.sceneAwarenessEnabled);
  const hdrModeEnabled = computed(() => settingsStore.hdrModeEnabled);
  const currentParticle = computed(() => settingsStore.backgroundEffect);

  // 记录进入设置页时的初始值；开关改变后「立即重启」按钮才可用，改回原值则恢复置灰
  const initialHdrMode = ref(settingsStore.hdrModeEnabled);
  const hdrChanged = computed(() => settingsStore.hdrModeEnabled !== initialHdrMode.value);

  // 立即重启应用（HDR 模式等设置需重启后生效）
  async function restartApp() {
    const ok = await dialogStore.confirm(t("settings.background.hdr.restartConfirm"));
    if (!ok) return;
    try {
      await relaunch();
    } catch (e) {
      console.error("重启失败:", e);
      dialogStore.alert(t("settings.background.hdr.restartFailed"));
    }
  }
  const meteorFps = computed({
    get: () => settingsStore.meteorFps,
    set: (value: number) => {
      const clampedValue = Math.max(10, Math.min(60, value));
      settingsStore.setMeteorFps(clampedValue);
    },
  });
  const meteorFpsInput = ref(settingsStore.meteorFps);

  const starsFps = computed({
    get: () => settingsStore.starsFps,
    set: (value: number) => {
      const clampedValue = Math.max(10, Math.min(60, value));
      settingsStore.setStarsFps(clampedValue);
    },
  });
  const starsFpsInput = ref(settingsStore.starsFps);

  const backgroundList = ref<BackgroundImageInfo[]>([]);
  const uploadInput = ref<HTMLInputElement | null>(null);

  // ── 硬件性能检测（CPU + GPU） ──
  const cpuInfo = ref<CpuInfo | null>(null);
  const gpuInfo = ref<GpuInfo | null>(null);
  const activeGpu = ref<GpuInfo | null>(null);
  const perfLoading = ref(true);
  const perfError = ref<string | null>(null);

  /** 性能等级徽章样式 */
  function tierBadgeClassFor(tier: PerfTier): string {
    switch (tier) {
      case "Internet":
        return "bg-gray-500/60 text-gray-100";
      case "Low":
        return "bg-yellow-600/60 text-yellow-100";
      case "Medium":
        return "bg-blue-500/60 text-blue-100";
      case "High":
        return "bg-green-500/60 text-green-100";
      default:
        return "bg-white/20 text-white/60";
    }
  }

  /** 综合性能等级（取最低；GPU 分级不适用时仅按 CPU）。GPU 取「当前调用」优先，回退「最高性能」。 */
  const combinedTier = computed<PerfTier | null>(() => {
    if (!cpuInfo.value) return null;
    const cpuTier = cpuInfo.value.tier as PerfTier;
    const activeTier =
      activeGpu.value?.is_applicable && activeGpu.value.name
        ? (activeGpu.value.tier as PerfTier)
        : null;
    const maxTier = gpuInfo.value?.is_applicable ? (gpuInfo.value.tier as PerfTier) : null;
    const gpuTier = activeTier ?? maxTier;
    return getCombinedTier(cpuTier, gpuTier);
  });

  const suggestedFps = computed(() =>
    combinedTier.value ? getSuggestedMaxFps(combinedTier.value) : 30
  );

  const scenes = ref<SceneInfo[]>([]);
  const { pending: refreshing, run: runSceneRefresh } = useLightingOperation();

  // 分页
  const ITEMS_PER_PAGE = 6;
  const currentPage = ref(1);
  const totalPages = computed(() => Math.max(1, Math.ceil(scenes.value.length / ITEMS_PER_PAGE)));
  const paginatedScenes = computed(() => {
    const start = (currentPage.value - 1) * ITEMS_PER_PAGE;
    return scenes.value.slice(start, start + ITEMS_PER_PAGE);
  });
  // 场景变化时回到第一页
  watch(scenes, () => {
    if (currentPage.value > totalPages.value) currentPage.value = totalPages.value;
  });

  const showSceneEdit = ref(false);
  const editMode = ref<"create" | "update">("create");
  const editingSceneId = ref<string | null>(null);
  const editInitialData = ref<
    | (SceneLightingMetadata & {
        sceneName: string;
        sceneImage: string | null;
        sceneDescription: string;
        lighting?: LightingParams | null;
      })
    | undefined
  >();

  const currentSceneDisplay = computed(
    () => gameStore.currentScene?.scene_name || t("settings.background.scene.none")
  );
  const currentScene = computed(() => gameStore.currentScene);
  const canSaveSceneDefault = computed(
    () => currentScene.value && (!currentScene.value.source || currentScene.value.source === "game")
  );
  const { pending: savingDefault, run: runDefaultSave } = useLightingOperation();
  const handleSaveSceneDefault = () => {
    const scene = currentScene.value;
    if (!scene || !canSaveSceneDefault.value) return;
    const req: UpdateSceneRequest = JSON.parse(
      JSON.stringify({
        id: scene.id,
        scene_name: scene.scene_name,
        scene_description: scene.scene_description,
        background: scene.background ?? "",
        lighting: gameStore.activeLighting,
        lighting_preset_id: gameStore.activeLightingPresetId,
        lighting_preset_revision: gameStore.activeLightingPresetRevision,
        lighting_customized: gameStore.activeLightingCustomized,
        apply_lighting_as_default: true,
      })
    );
    return runDefaultSave(
      async () => {
        await updateScene(req);
        await fetchScenes();
      },
      lightingText("sceneDefaultSaved", "已保存为当前场景默认")
    );
  };

  const fetchScenes = async () => {
    scenes.value = await listScenes();
  };

  const handleRefreshScenes = () =>
    runSceneRefresh(async () => {
      await Promise.all([fetchScenes(), refreshBackground()]);
    }, t("settings.background.scene.refreshSuccess"));

  const isSceneSelected = (sceneId: string): boolean => {
    return gameStore.currentScene?.id === sceneId;
  };

  const { pending: selectingScene, run: runSceneSelection } = useLightingOperation();
  const handleSceneClick = (scene: SceneInfo) => {
    const sceneId = gameStore.currentScene?.id === scene.id ? null : scene.id;
    return runSceneSelection(async () => {
      if (sceneId && !scene.scene_description?.trim()) {
        uiStore.showInfo({
          title: t("settings.background.scene.tip"),
          message: t("settings.background.scene.noDescriptionTip", { name: scene.scene_name }),
          duration: 4000,
        });
      }
      await selectScene(sceneId);
      if (sceneId === null) unlockAchievement("see_through").catch(console.error);
      await fetchScenes();
    });
  };

  const handleWrenchClick = (scene: SceneInfo) => {
    editMode.value = "update";
    editingSceneId.value = scene.id;
    editInitialData.value = {
      sceneName: scene.scene_name,
      sceneImage: scene.background || null,
      sceneDescription: scene.scene_description,
      lighting: scene.lighting,
      ...getSceneLightingMetadata(scene),
    };
    showSceneEdit.value = true;
  };

  const handleCreateScene = () => {
    editMode.value = "create";
    editingSceneId.value = null;
    editInitialData.value = undefined;
    showSceneEdit.value = true;
  };

  const { pending: deletingScene, run: runSceneDelete } = useLightingOperation();
  const handleDeleteScene = () => {
    const scene = currentScene.value;
    if (!scene) return;
    return runSceneDelete(async () => {
      if (scene.source && scene.source !== "game") {
        await dialogStore.alert(t("settings.background.scene.pluginNotDeletable"));
        return;
      }
      if (
        !(await dialogStore.confirm(
          t("settings.background.scene.deleteConfirm", { name: scene.scene_name })
        ))
      )
        return;
      await deleteScene(scene.id);
      await fetchScenes();
    });
  };

  const handleSceneSubmit = async (
    data: SceneLightingMetadata & {
      sceneName: string;
      sceneImage: string | null;
      sceneDescription: string;
      lighting?: LightingParams | null;
    },
    context: { sceneKey?: string | null; mode: "create" | "update" }
  ) => {
    try {
      if (context.mode === "create") {
        await createScene({
          scene_name: data.sceneName,
          scene_description: data.sceneDescription,
          background: data.sceneImage || "",
          lighting: data.lighting ?? null,
          lighting_preset_id: data.lighting_preset_id,
          lighting_preset_revision: data.lighting_preset_revision,
          lighting_customized: data.lighting_customized,
        });
      } else {
        if (!context.sceneKey) throw new Error("Missing scene ID");
        await updateScene({
          id: context.sceneKey,
          scene_name: data.sceneName,
          scene_description: data.sceneDescription,
          background: data.sceneImage || "",
          lighting: data.lighting ?? null,
          lighting_preset_id: data.lighting_preset_id,
          lighting_preset_revision: data.lighting_preset_revision,
          lighting_customized: data.lighting_customized,
        });
      }
      await fetchScenes();
    } catch (error) {
      throw error;
    }
  };

  onMounted(async () => {
    await runSceneRefresh(async () => {
      await Promise.all([refreshBackground(), fetchScenes()]);
    });
    await fetchPerfInfo();
  });

  // ── 硬件性能检测（CPU + GPU） ──

  async function fetchPerfInfo(): Promise<void> {
    perfLoading.value = true;
    perfError.value = null;
    try {
      // activeGpu 读取真实 WebGL 渲染器（反映当前实际调用的 GPU），失败不影响其余信息
      const [cpu, gpu, active] = await Promise.all([
        getCpuInfo(),
        getGpuInfo(),
        getActiveGpu().catch(() => null),
      ]);
      cpuInfo.value = cpu;
      gpuInfo.value = gpu;
      activeGpu.value = active;
    } catch (e: any) {
      perfError.value = e?.message || t("settings.background.perf.fetchFailed");
      console.error("获取硬件性能信息失败", e);
    } finally {
      perfLoading.value = false;
    }
  }

  async function handleRedetectPerf(): Promise<void> {
    perfLoading.value = true;
    perfError.value = null;
    try {
      const [cpu, gpu, active] = await Promise.all([
        redetectCpu(),
        redetectGpu(),
        getActiveGpu().catch(() => null),
      ]);
      cpuInfo.value = cpu;
      gpuInfo.value = gpu;
      activeGpu.value = active;
      uiStore.showSuccess({
        title: t("settings.background.perf.detectComplete"),
        message: t("settings.background.perf.tierMessage", {
          tier: combinedTier.value
            ? getTierLabel(combinedTier.value)
            : t("settings.background.perf.unknown"),
        }),
        duration: 3000,
      });
    } catch (e: any) {
      perfError.value = e?.message || t("settings.background.perf.redetectFailed");
      console.error("重新检测硬件性能失败", e);
    } finally {
      perfLoading.value = false;
    }
  }

  async function fetchBackgrounds(): Promise<BackgroundImageInfo[]> {
    const data = await getBackgroundImages();
    return data.map((background: BackgroundImageInfo) => ({
      title: background.title || "Untitled",
      url: background.url || "",
      time: background.time,
    }));
  }

  async function refreshBackground(): Promise<void> {
    const items = await fetchBackgrounds();
    backgroundList.value = items;
  }

  function triggerUpload(): void {
    uploadInput.value?.click();
  }

  const { pending: uploadingBackground, run: runBackgroundUpload } = useLightingOperation();
  function handleFileUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    return runBackgroundUpload(async () => {
      const fileName = file.name;
      const fileExt = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
      const allowedExts = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".svg", ".tif", ".gif"];
      if (!allowedExts.includes(fileExt)) {
        await dialogStore.alert(
          t("settings.background.upload.invalidFormat", { formats: allowedExts.join(", ") })
        );
        return;
      }
      const buf = await file.arrayBuffer();
      await uploadBackgroundImage(fileName, new Uint8Array(buf));
      await refreshBackground();
      await fetchScenes();
      target.value = "";
    });
  }

  function updateParticle(value: string): void {
    uiStore.setBackgroundEffect(value);
  }

  const { pending: openingFolder, run: runOpenFolder } = useLightingOperation();
  const handleOpenFolder = () => runOpenFolder(openBackgroundsFolder);

  function handleMeteorFpsChange(value: number) {
    const clampedValue = Math.max(10, Math.min(60, value));
    meteorFpsInput.value = clampedValue;
    settingsStore.setMeteorFps(clampedValue);
  }

  function handleInputBlur() {
    let value = Number(meteorFpsInput.value);
    if (isNaN(value) || value < 10) value = 10;
    else if (value > 300) value = 300;
    meteorFpsInput.value = value;
    settingsStore.setMeteorFps(value);
  }

  function handleInputEnter() {
    handleInputBlur();
  }

  watch(meteorFps, (newValue) => {
    meteorFpsInput.value = newValue;
  });

  function handleStarsFpsChange(value: number) {
    const clampedValue = Math.max(10, Math.min(60, value));
    starsFpsInput.value = clampedValue;
    settingsStore.setStarsFps(clampedValue);
  }

  function handleStarsInputBlur() {
    let value = Number(starsFpsInput.value);
    if (isNaN(value) || value < 10) value = 10;
    else if (value > 300) value = 300;
    starsFpsInput.value = value;
    settingsStore.setStarsFps(value);
  }

  function handleStarsInputEnter() {
    handleStarsInputBlur();
  }

  watch(starsFps, (newValue) => {
    starsFpsInput.value = newValue;
  });

  // ── 对话框外观 ──
  const dialogBgInput = ref<HTMLInputElement | null>(null);

  function hexToRgba(hex: string, alpha: number): string {
    const m = hex.replace("#", "").match(/^([0-9a-fA-F]{6})$/);
    if (!m) return `rgba(0,14,39,${alpha})`;
    const r = parseInt(m[1]!.substring(0, 2), 16);
    const g = parseInt(m[1]!.substring(2, 4), 16);
    const b = parseInt(m[1]!.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
</script>
