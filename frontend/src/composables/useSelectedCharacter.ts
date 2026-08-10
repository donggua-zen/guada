import { ref } from 'vue'

const selectedCharacterId = ref<string | null>(null)

/**
 * Cross-page character pre-selection mechanism.
 * Used to pass a selected character from the assistant page to CreateSessionChatPanel,
 * instead of URL query params (avoids stale history / refresh reset issues).
 */
export function useSelectedCharacter() {
  return {
    selectedCharacterId,
    setSelectedCharacter: (id: string) => { selectedCharacterId.value = id },
    consumeSelectedCharacter: (): string | null => {
      const id = selectedCharacterId.value
      selectedCharacterId.value = null
      return id
    }
  }
}
