import { ref } from 'vue'

const selectedAgentId = ref<string | null>(null)

/**
 * Cross-page agent pre-selection mechanism.
 * Used to pass a selected agent from the assistant page to CreateSessionChatPanel,
 * instead of URL query params (avoids stale history / refresh reset issues).
 */
export function useSelectedAgent() {
  return {
    selectedAgentId,
    setSelectedAgent: (id: string) => { selectedAgentId.value = id },
    consumeSelectedAgent: (): string | null => {
      const id = selectedAgentId.value
      selectedAgentId.value = null
      return id
    }
  }
}
