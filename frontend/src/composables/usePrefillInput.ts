import { ref } from 'vue'

const prefillText = ref('')

/**
 * Cross-page pre-fill mechanism for chat input.
 * Used to pass text from other pages (e.g. scheduler) to CreateSessionChatPanel.
 */
export function usePrefillInput() {
  return {
    prefillText,
    setPrefill: (text: string) => { prefillText.value = text },
    consumePrefill: (): string => {
      const text = prefillText.value
      prefillText.value = ''
      return text
    }
  }
}
