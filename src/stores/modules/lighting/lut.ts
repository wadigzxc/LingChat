/**
 * 调色表（Photoshop「导出颜色查找表」的 .cube）：库的读写，以及「原图 → 已调色图」的换算。
 *
 * 调色不在前端算：背景与立绘是以 CSS 背景图渲染的，asset 协议送出的图与页面不同源，
 * 画进 canvas 就读不回像素。所以让后端把表烘成一张缓存图，这里只负责「拿原图路径换
 * 缓存路径」——换不到就先用原图，烘完响应式替换，画面不会因为一份坏表黑掉。
 *
 * 生效条件挂在 `useLightingStore().active` 上（总开关、优先级、低性能都在那边裁决），
 * 这里不再自己判断该用哪盏灯的调色表。
 */
import { defineStore } from "pinia";

import {
  bakeLightingLut,
  deleteLightingLut,
  importLightingLut,
  listLightingLuts,
} from "@/api/services/lighting";
import type { LutInfo } from "@/api/services/lighting";
import { useLightingStore } from "./index";

/** 请求中的缓存键：同一张图同时被背景和 bloom 层要时，只烘一次。 */
const pending = new Set<string>();

/**
 * 每张图最多只有一个「等着烘」的请求。
 *
 * 拖强度滑块时每停一次都是一个新键，直接发就会连着排几十次烘焙：4K 图一张几百毫秒
 * CPU，全程占满之后画面反而更晚出来，缓存目录里还留下一堆只看了一眼的图。所以同一张
 * 图后来的请求把前一个撤掉，只在手停下来之后烘那一张最终值。
 */
const scheduled = new Map<string, ReturnType<typeof setTimeout>>();
const SETTLE_MS = 250;

/** 只有本地文件能交给后端烘；网络图、内联 data: 与静态资源原样透出。 */
function isLocalFile(path: string): boolean {
  return !!path && !/^(https?:|data:|blob:|@\/|\/\/)/.test(path);
}

/** 校验这张表还在库里、强度可用；任何一条不满足都返回「不调色」。 */
function pickLut(
  luts: LutInfo[],
  id: string | null | undefined,
  strength: number | undefined,
  compareOriginal: boolean,
): { id: string; strength: number } | null {
  if (!id || compareOriginal) return null;
  const value = Math.min(1, strength ?? 1);
  if (value <= 0) return null;
  // 查不到就是已经被删了：留着 id 只会让画面和状态各说各话，宁可不调色。
  if (!luts.some((lut) => lut.id === id)) return null;
  return { id, strength: value };
}

export const useLightingLutStore = defineStore("lightingLut", {
  state: () => ({
    luts: [] as LutInfo[],
    loaded: false,
    /** 缓存键（原图 + 表 + 强度）→ 烘焙后的绝对路径 */
    baked: {} as Record<string, string>,
    /** 临时「显示调色前」：只影响画面，不改预设参数 */
    compareOriginal: false,
  }),

  getters: {
    /** 屏幕上该用的调色表与强度（跟着 `useLightingStore().active` 那盏灯走）。 */
    active(): { id: string; strength: number } | null {
      const params = useLightingStore().active;
      return pickLut(
        this.luts,
        params?.color_lut,
        params?.color_lut_strength,
        this.compareOriginal,
      );
    },

    /** 调色表条目的下拉选项（面板与编辑器共用）。 */
    options(state): { value: string; label: string }[] {
      return state.luts.map((lut) => ({ value: lut.id, label: `${lut.name}（${lut.size}³）` }));
    },
  },

  actions: {
    /** 编辑器用：草稿里的调色表（未必是屏幕上那盏灯）解析成可用描述。 */
    resolve(id?: string | null, strength?: number): { id: string; strength: number } | null {
      return pickLut(this.luts, id, strength, this.compareOriginal);
    },

    async ensureLoaded() {
      if (this.loaded) return;
      this.loaded = true;
      try {
        this.luts = await listLightingLuts();
      } catch (e) {
        this.loaded = false;
        console.warn("[LightingLut] 调色表列表加载失败:", e);
      }
    },

    async refresh() {
      this.luts = await listLightingLuts();
      this.loaded = true;
    },

    /** 导入一份 .cube。校验不过时把后端的中文原因原样抛给调用方显示。 */
    async importLut(path: string, name?: string): Promise<LutInfo> {
      const info = await importLightingLut({ path, name });
      await this.refresh();
      return info;
    },

    async removeLut(id: string) {
      await deleteLightingLut(id);
      await this.refresh();
    },

    /**
     * 原图路径 → 该显示的路径。
     *
     * 同步返回：命中缓存给烘焙后的图，没命中就先给原图并排一次烘焙（值还在动的时候
     * 不真发，停手才发）。调用方把它放在 computed 里即可，`baked` 一写回 computed 会
     * 重算，画面自己补上调色结果。
     *
     * `active` 省略时按屏幕上那盏灯算；编辑器要预览草稿里尚未生效的调色表，所以允许
     * 显式传一份（传 null 就是明确不套表）。
     */
    displayPath(path: string, active?: { id: string; strength: number } | null): string {
      const target = active === undefined ? this.active : active;
      if (!target || !isLocalFile(path)) return path;
      const key = `${target.id}|${target.strength}|${path}`;
      const hit = this.baked[key];
      if (hit) return hit;
      if (!pending.has(key)) {
        const waiting = scheduled.get(path);
        if (waiting) clearTimeout(waiting);
        scheduled.set(
          path,
          setTimeout(() => {
            scheduled.delete(path);
            if (this.baked[key]) return;
            pending.add(key);
            bakeLightingLut({ imagePath: path, lutId: target.id, strength: target.strength })
              .then((baked) => {
                this.baked[key] = baked;
              })
              .catch((e) => console.warn("[LightingLut] 调色表烘焙失败:", e))
              .finally(() => pending.delete(key));
          }, SETTLE_MS),
        );
      }
      return path;
    },
  },
});
