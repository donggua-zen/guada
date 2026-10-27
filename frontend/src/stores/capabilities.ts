import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { apiService } from "@/services/ApiService";
import {
  ALL_SANDBOX_MODES,
  isSandboxMode,
  normalizeSandboxMode,
  supportedSandboxModes,
  type SandboxMode,
} from "@/utils/sandboxMode";

export { ALL_SANDBOX_MODES, isSandboxMode };
export type { SandboxMode };

/**
 * 后端能力缓存。
 *
 * 请求失败时回退到三档（保持旧行为），执行侧后端仍会按平台归一化，
 * 因此不会出现“前端可选但实际不生效”的权限分叉。
 */
export const useCapabilitiesStore = defineStore("capabilities", () => {
  // Electron 宿主平台只作为首帧提示（避免 Windows 上已选 read-only 的会话
  // 闪一下旧档位）；最终以后端 /capabilities 为准。
  const initialWindows =
    typeof window !== "undefined" && window.electronAPI?.platform === "win32";
  const platform = ref<string | null>(initialWindows ? "win32" : null);
  const sandboxModes = ref<SandboxMode[]>(supportedSandboxModes(platform.value));
  const loaded = ref(false);
  let pending: Promise<void> | null = null;

  const isWindows = computed(() => platform.value === "win32");

  async function ensureLoaded(force = false): Promise<void> {
    if (loaded.value && !force) return;
    if (pending) return pending;

    pending = (async () => {
      try {
        const caps = await apiService.fetchCapabilities();
        const nextPlatform =
          typeof caps?.platform === "string" ? caps.platform : null;
        platform.value = nextPlatform;
        const modes = Array.isArray(caps?.sandboxModes)
          ? caps.sandboxModes.filter(isSandboxMode)
          : [];
        sandboxModes.value =
          modes.length > 0 ? modes : supportedSandboxModes(nextPlatform);
        // 只在成功时标记已加载：冷启动/后端未就绪的首轮失败，下一次挂载会重试。
        loaded.value = true;
      } catch (error) {
        console.warn(
          "[capabilities] fetch failed, fallback to all sandbox modes",
          error,
        );
      } finally {
        pending = null;
      }
    })();

    return pending;
  }

  function isSupported(mode: unknown): mode is SandboxMode {
    return isSandboxMode(mode) && sandboxModes.value.includes(mode);
  }

  /** 把历史值/非法值收敛为当前后端支持的档位（Windows 上 read-only → workspace-write）。 */
  function normalize(mode: unknown): SandboxMode {
    return normalizeSandboxMode(mode, platform.value);
  }

  return {
    platform,
    sandboxModes,
    loaded,
    isWindows,
    ensureLoaded,
    isSupported,
    normalize,
  };
});
