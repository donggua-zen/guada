export default {
  // Phase 5 subagent will populate this file (session/search/group related)

  // ── bot store ──
  bot: {
    loadPlatformsFailed: 'Failed to load platform list',
    loadBotsFailed: 'Failed to load bot list',
    createSuccess: 'Bot created successfully',
    createFailed: 'Failed to create bot',
    updateSuccess: 'Bot updated successfully',
    updateFailed: 'Failed to update bot',
    deleteSuccess: 'Bot deleted successfully',
    deleteFailed: 'Failed to delete bot',
    starting: 'Bot starting...',
    startFailed: 'Failed to start bot',
    stopped: 'Bot stopped',
    stopFailed: 'Failed to stop bot',
    restarting: 'Bot restarting...',
    restartFailed: 'Failed to restart bot',
  },

  // ── popup ──
  popup: {
    inputPlaceholder: 'Enter content',
    contentRequired: 'Content cannot be empty',
    editTitle: 'Edit Content',
    processing: 'Processing...',
  },

  // ── context menu manager ──
  contextMenu: {
    copy: 'Copy',
    paste: 'Paste',
    cut: 'Cut',
    selectAll: 'Select All',
    openInNewWindow: 'Open in New Window',
    copyLink: 'Copy Link',
    saveImage: 'Save Image',
    refresh: 'Refresh',
  },

  // ── workspace preview ──
  workspace: {
    selectLinkMode: 'Select how to open links',
    internalBrowser: 'Internal Browser',
    externalBrowser: 'External Browser',
  },

  // ── format time ──
  time: {
    yesterday: 'Yesterday',
    dayBeforeYesterday: 'Day before yesterday',
    sunday: 'Sun',
    monday: 'Mon',
    tuesday: 'Tue',
    wednesday: 'Wed',
    thursday: 'Thu',
    friday: 'Fri',
    saturday: 'Sat',
    lastWeek: 'Last week',
    monthDay: '{month}/{day}',
    earlier: 'Earlier',
  },

  // ── api service ──
  api: {
    cannotConnect: 'Cannot connect to the backend service. Please ensure the application is fully started.',
    requestFailed: 'Request failed',
    responseFailed: 'Failed to get response: {status}',
    sendFailed: 'Send failed: {status}',
  },

  // ── 会话搜索 (SessionSearchDialog.vue) ──
  search: {
    placeholder: 'Search session titles or content...',
    searching: 'Searching...',
    searchFailed: 'Failed to search sessions',
    contentMatch: 'Content',
    noResults: 'No matching sessions found',
    initial: 'Enter keywords to search sessions',
    loadMore: 'Load More',
    loadingMore: 'Loading...',
    ungrouped: 'Task List',
    timeNow: 'now',
    timeMin: '{n}min',
    timeHour: '{n}h',
    timeDay: '{n}d',
    timeMonth: '{n}mo',
    timeEarlier: 'Earlier',
  },

  // ── 会话分组管理 (SessionGroupManageDialog.vue) ──
  group: {
    title: 'Group Management',
    newPlaceholder: 'Enter a new group name',
    create: 'Create',
    empty: 'No custom groups',
    save: 'Save',
    cancel: 'Cancel',
    deleteTitle: 'Delete Group',
    deleteConfirm: 'Are you sure you want to delete group "{name}"? Sessions in this group will be moved to ungrouped.',
    createSuccess: 'Group created successfully',
    createFailed: 'Failed to create group',
    updateSuccess: 'Group name updated',
    updateFailed: 'Update failed',
    deleteSuccess: 'Group deleted',
    deleteFailed: 'Deletion failed',
    nameEmpty: 'Group name cannot be empty',
    reorderSuccess: 'Group order updated',
    reorderFailed: 'Failed to update order',
    tipsTitle: 'Tips:',
    tip1: 'Drag to reorder groups',
    tip2: 'After deleting a group, sessions in that group will be moved to "Task List"',
    tip3: '"Task List" is the default group and cannot be deleted or renamed',
  },
}
