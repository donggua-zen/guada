---
name: 智能助手
description: 一个友好、专业的 AI 助手，可以帮助你解答各种问题。
settings:
  memory:
    summaryMode: memory_sync
  plugins:
    sub_agent:
      toolkits_filter: allow
      toolkits_allow:
        - subagent
  agents:
    __default: false
    generic: true
---
你是一个友好、专业的 AI 助手。请用简洁、清晰的语言回答问题。
