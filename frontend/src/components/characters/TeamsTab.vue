<template>
  <div class="py-3 w-full min-w-0">
    <!-- 新建团队 -->
    <div class="flex items-center justify-between mb-6">
      <el-button type="primary" @click="showCreateDialog = true" class="flex items-center shrink-0">
        <template #icon>
          <PlusOutlined />
        </template>
        新建团队
      </el-button>
      <span class="text-sm text-gray-500 dark:text-[#8b8d95] whitespace-nowrap ml-4">
        将多个角色组合成协作团队
      </span>
    </div>

    <!-- 团队列表 -->
    <div class="pt-4">
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 w-full">
        <div v-for="team in teams" :key="team.id"
          class="provider-card group relative bg-white dark:bg-[#232428] border border-gray-200 dark:border-[#232428] rounded-lg p-4 cursor-default hover:border-(--color-primary) transition-all duration-200 overflow-hidden">

          <div class="relative z-10 flex flex-col h-full">
            <!-- 团队头部：头像 + 名称 -->
            <div class="flex items-start gap-3">
              <Avatar class="w-11 h-11 shrink-0" :src="team.avatarUrl || team.leader?.avatarUrl" :name="team.name" type="assistant" />
              <div class="flex-1 min-w-0">
                <div class="flex items-start justify-between">
                  <div class="font-medium text-base text-gray-900 dark:text-[#e8e9ed] truncate" :title="team.name">
                    {{ team.name }}
                  </div>
                  <el-button link size="small" type="danger"
                    class="opacity-0 group-hover:opacity-100 transition-all duration-200 delete-btn"
                    @click.stop="deleteTeam(team)">
                    <el-icon :size="18">
                      <DeleteOutlineOutlined />
                    </el-icon>
                  </el-button>
                </div>
                <div class="text-xs text-gray-500 dark:text-[#8b8d95] mt-1.5">
                  {{ getMemberSummary(team) }}
                </div>
              </div>
            </div>

            <!-- 描述 -->
            <div class="text-xs text-gray-400 dark:text-[#6b6d75] mt-2 line-clamp-2 leading-relaxed">
              {{ team.description || '暂无描述' }}
            </div>

            <!-- 成员列表 -->
            <div class="mt-2 flex items-center gap-1 flex-wrap">
              <div v-for="member in (team.members || [])" :key="member.id"
                class="flex items-center gap-1 pl-1 pr-2 py-0.5 rounded-full text-xs"
                :class="member.role === 'leader'
                  ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800'
                  : 'bg-gray-100 dark:bg-[#2a2c30] text-gray-600 dark:text-[#8b8d95]'">
                <Avatar class="w-4 h-4" :src="member.character?.avatarUrl" :name="member.character?.title || '成员'" type="assistant" />
                <span>{{ member.character?.title || '成员' }}</span>
                <span v-if="member.role === 'leader'" class="text-[10px] ml-0.5">主理</span>
              </div>
            </div>
          </div>

          <!-- 悬停按钮 -->
          <div class="absolute inset-x-0 bottom-0 h-16 bg-linear-to-t from-white dark:from-[#232428] via-white/90 dark:via-[#232428]/90 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none rounded-b-lg"></div>
          <div class="absolute inset-x-2 bottom-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-auto z-20">
            <el-button type="primary" size="small" class="flex-1 shadow-sm" @click.stop="$emit('startTeamChat', team)">
              开始协作
            </el-button>
            <el-button size="small" class="flex-1 shadow-sm" @click.stop="editTeam(team)">
              团队设置
            </el-button>
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="!loading && teams.length === 0"
          class="col-span-full text-center py-12 text-gray-500 dark:text-[#8b8d95]">
          <el-icon size="48" class="text-gray-300 dark:text-[#5a5c63] mb-3">
            <PeopleTeam24Regular />
          </el-icon>
          <p class="text-lg">暂无团队</p>
          <p class="text-sm mt-1">创建一个团队，组合多个角色协同工作</p>
        </div>
      </div>
    </div>

    <!-- 创建/编辑团队弹窗 -->
    <el-dialog v-model="showCreateDialog" :title="editingTeam ? '编辑团队' : '新建团队'" :width="isMobile ? '90%' : '560px'"
      :append-to-body="true" @close="resetForm">
      <el-form :model="teamForm" label-position="top" class="team-form">
        <el-form-item label="团队名称" required>
          <el-input v-model="teamForm.name" placeholder="如：视频制作、内容策划" maxlength="30" show-word-limit />
        </el-form-item>

        <el-form-item label="团队描述">
          <el-input v-model="teamForm.description" type="textarea" :rows="2" placeholder="简单描述团队的用途" maxlength="200" show-word-limit />
        </el-form-item>

        <el-form-item label="主理人（团队核心角色）" required>
          <div class="w-full">
            <div class="character-selector p-2 bg-gray-50 dark:bg-[#2a2c30] rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-[#2f3131] transition-colors"
              @click="showLeaderSelector = true">
              <template v-if="teamForm.leaderCharacterId && getCharacter(teamForm.leaderCharacterId)">
                <div class="flex items-center gap-2">
                  <Avatar class="w-8 h-8" :src="getCharacter(teamForm.leaderCharacterId)?.avatarUrl"
                    :name="getCharacter(teamForm.leaderCharacterId)?.title" type="assistant" />
                  <div>
                    <p class="text-sm font-medium text-gray-900 dark:text-[#e8e9ed]">{{ getCharacter(teamForm.leaderCharacterId)?.title }}</p>
                    <p class="text-xs text-gray-500 dark:text-[#8b8d95]">{{ getCharacter(teamForm.leaderCharacterId)?.description?.substring(0, 40) || '暂无描述' }}</p>
                  </div>
                </div>
              </template>
              <template v-else>
                <div class="text-sm text-gray-400 dark:text-[#6b6d75] flex items-center gap-2">
                  <el-icon><PlusOutlined /></el-icon>
                  选择主理人角色
                </div>
              </template>
            </div>
          </div>
        </el-form-item>

        <el-form-item label="团队成员">
          <div class="w-full space-y-2">
            <!-- 已选成员 -->
            <div v-for="(memberCharId, index) in teamForm.memberCharacterIds" :key="index"
              class="flex items-center gap-2 p-2 bg-gray-50 dark:bg-[#2a2c30] rounded-lg">
              <Avatar class="w-7 h-7" :src="getCharacter(memberCharId)?.avatarUrl"
                :name="getCharacter(memberCharId)?.title" type="assistant" />
              <span class="flex-1 text-sm text-gray-900 dark:text-[#e8e9ed]">{{ getCharacter(memberCharId)?.title || '未知角色' }}</span>
              <el-button link size="small" type="danger" @click="removeMember(index)">
                <el-icon :size="14"><DeleteOutlineOutlined /></el-icon>
              </el-button>
            </div>
            <!-- 添加成员按钮 -->
            <el-button size="small" @click="showMemberSelector = true" :disabled="!teamForm.leaderCharacterId">
              <el-icon class="mr-1"><PlusOutlined /></el-icon>
              添加成员
            </el-button>
            <div v-if="!teamForm.leaderCharacterId" class="text-xs text-gray-400">请先选择主理人</div>
          </div>
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="saveTeam" :disabled="!teamForm.name || !teamForm.leaderCharacterId">
          {{ editingTeam ? '保存' : '创建' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 主理人选择器弹窗 -->
    <el-dialog v-model="showLeaderSelector" title="选择主理人" :width="isMobile ? '90%' : '400px'" :append-to-body="true">
      <div class="mb-3">
        <el-input v-model="leaderSearchText" placeholder="搜索角色..." clearable>
          <template #prefix>
            <el-icon><SearchFilled /></el-icon>
          </template>
        </el-input>
      </div>
      <div class="max-h-72 overflow-y-auto space-y-1">
        <div v-for="char in filteredLeaderCharacters" :key="char.id"
          class="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-[#2f3131] transition-colors"
          :class="{ 'bg-blue-50 dark:bg-[#2f3131] border border-blue-200 dark:border-[#2f3131]': teamForm.leaderCharacterId === char.id }"
          @click="selectLeader(char)">
          <Avatar class="w-10 h-10" :src="char.avatarUrl" :name="char.title" type="assistant" />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-700 dark:text-(--color-text) truncate">{{ char.title }}</p>
            <p class="text-xs text-gray-500 dark:text-(--color-text-gray) truncate mt-0.5">{{ char.description || '暂无描述' }}</p>
          </div>
          <el-icon v-if="teamForm.leaderCharacterId === char.id" class="text-blue-500 dark:text-(--color-primary) shrink-0" size="18">
            <CheckCircleFilled />
          </el-icon>
        </div>
      </div>
    </el-dialog>

    <!-- 成员选择器弹窗 -->
    <el-dialog v-model="showMemberSelector" title="添加团队成员" :width="isMobile ? '90%' : '400px'" :append-to-body="true">
      <div class="mb-3">
        <el-input v-model="memberSearchText" placeholder="搜索角色..." clearable>
          <template #prefix>
            <el-icon><SearchFilled /></el-icon>
          </template>
        </el-input>
      </div>
      <div class="max-h-72 overflow-y-auto space-y-1">
        <div v-for="char in filteredMemberCharacters" :key="char.id"
          class="flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-[#2f3131] transition-colors"
          :class="{ 'bg-blue-50 dark:bg-[#2f3131]': teamForm.memberCharacterIds.includes(char.id) }"
          @click="toggleMember(char)">
          <Avatar class="w-10 h-10" :src="char.avatarUrl" :name="char.title" type="assistant" />
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-gray-700 dark:text-(--color-text) truncate">{{ char.title }}</p>
            <p class="text-xs text-gray-500 dark:text-(--color-text-gray) truncate mt-0.5">{{ char.description || '暂无描述' }}</p>
          </div>
          <el-icon v-if="teamForm.memberCharacterIds.includes(char.id)" class="text-blue-500 dark:text-(--color-primary) shrink-0" size="18">
            <CheckCircleFilled />
          </el-icon>
        </div>
      </div>
      <template #footer>
        <el-button @click="showMemberSelector = false">完成</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElIcon, ElButton, ElDialog, ElForm, ElFormItem, ElInput } from 'element-plus'
import { PlusOutlined, DeleteOutlineOutlined, SearchFilled, CheckCircleFilled } from '@vicons/material'
import { PeopleTeam24Regular } from '@vicons/fluent'
import { Avatar } from '../ui'
import { apiService } from '../../services/ApiService'
import { usePopup } from '../../composables/usePopup'
import { useBreakpoints, breakpointsTailwind } from '@vueuse/core'

const breakpoints = useBreakpoints(breakpointsTailwind)
const isMobile = breakpoints.smaller('md')
const { confirm, toast } = usePopup()

defineEmits<{
  startTeamChat: [team: any]
}>()

// ========== 团队列表 ==========
const teams = ref<any[]>([])
const loading = ref(false)

const loadTeams = async () => {
  loading.value = true
  try {
    const data: any = await apiService.fetchTeams()
    teams.value = data.items || (Array.isArray(data) ? data : [])
  } catch (error: any) {
    console.error('获取团队列表失败:', error)
    toast.error('获取团队列表失败')
  } finally {
    loading.value = false
  }
}

const deleteTeam = async (team: any) => {
  try {
    const result = await confirm('确认删除', `确定要删除团队「${team.name}」吗？此操作不可撤销。`)
    if (!result) return
    await apiService.deleteTeam(team.id)
    await loadTeams()
    toast.success('团队删除成功')
  } catch (error: any) {
    toast.error('删除失败')
    console.error('删除团队失败:', error)
  }
}

/** 生成成员摘要文案，与助手的"我的模板/共享模板"位置对齐 */
const getMemberSummary = (team: any) => {
  const members = team.members || []
  const leaderCount = members.filter((m: any) => m.role === 'leader').length
  const memberCount = members.filter((m: any) => m.role !== 'leader').length
  if (memberCount === 0 && leaderCount === 0) return '暂无成员'
  const parts: string[] = []
  if (leaderCount > 0) parts.push(`${leaderCount} 位主理人`)
  if (memberCount > 0) parts.push(`${memberCount} 位成员`)
  return parts.join(' · ')
}

// ========== 角色列表（用于选择器）==========
const allCharacters = ref<any[]>([])

const loadCharacters = async () => {
  try {
    const data = await apiService.fetchCharacters()
    allCharacters.value = data.items || data
  } catch (error: any) {
    console.error('获取角色列表失败:', error)
  }
}

const getCharacter = (id: string) => {
  return allCharacters.value.find(c => c.id === id)
}

// ========== 创建/编辑团队 ==========
const showCreateDialog = ref(false)
const editingTeam = ref<any>(null)

const teamForm = ref({
  name: '',
  description: '',
  leaderCharacterId: '',
  memberCharacterIds: [] as string[],
})

const resetForm = () => {
  teamForm.value = {
    name: '',
    description: '',
    leaderCharacterId: '',
    memberCharacterIds: [],
  }
  editingTeam.value = null
}

const editTeam = (team: any) => {
  editingTeam.value = team
  teamForm.value = {
    name: team.name || '',
    description: team.description || '',
    leaderCharacterId: team.leaderCharacterId || '',
    memberCharacterIds: (team.members || [])
      .filter((m: any) => m.role !== 'leader')
      .map((m: any) => m.characterId),
  }
  showCreateDialog.value = true
}

const saveTeam = async () => {
  try {
    const data = {
      name: teamForm.value.name,
      description: teamForm.value.description,
      leaderCharacterId: teamForm.value.leaderCharacterId,
      memberCharacterIds: teamForm.value.memberCharacterIds,
    }

    if (editingTeam.value) {
      await apiService.updateTeam(editingTeam.value.id, data)
      toast.success('团队更新成功')
    } else {
      await apiService.createTeam(data)
      toast.success('团队创建成功')
    }
    showCreateDialog.value = false
    resetForm()
    await loadTeams()
  } catch (error: any) {
    console.error('保存团队失败:', error)
    toast.error(error.message || '保存团队失败')
  }
}

// ========== 主理人选择器 ==========
const showLeaderSelector = ref(false)
const leaderSearchText = ref('')

const filteredLeaderCharacters = computed(() => {
  const text = leaderSearchText.value.toLowerCase()
  return allCharacters.value.filter(c => {
    if (text && !c.title?.toLowerCase().includes(text) && !c.description?.toLowerCase().includes(text)) return false
    return true
  })
})

const selectLeader = (character: any) => {
  // 如果之前选的主理人在成员里，先移除
  const oldLeaderId = teamForm.value.leaderCharacterId
  if (oldLeaderId) {
    teamForm.value.memberCharacterIds = teamForm.value.memberCharacterIds.filter(id => id !== oldLeaderId)
  }
  teamForm.value.leaderCharacterId = character.id
  // 新主理人不能同时在成员列表里
  teamForm.value.memberCharacterIds = teamForm.value.memberCharacterIds.filter(id => id !== character.id)
  showLeaderSelector.value = false
}

// ========== 成员选择器 ==========
const showMemberSelector = ref(false)
const memberSearchText = ref('')

const filteredMemberCharacters = computed(() => {
  const text = memberSearchText.value.toLowerCase()
  return allCharacters.value.filter(c => {
    // 排除主理人
    if (c.id === teamForm.value.leaderCharacterId) return false
    if (text && !c.title?.toLowerCase().includes(text) && !c.description?.toLowerCase().includes(text)) return false
    return true
  })
})

const toggleMember = (character: any) => {
  const idx = teamForm.value.memberCharacterIds.indexOf(character.id)
  if (idx >= 0) {
    teamForm.value.memberCharacterIds.splice(idx, 1)
  } else {
    teamForm.value.memberCharacterIds.push(character.id)
  }
}

const removeMember = (index: number) => {
  teamForm.value.memberCharacterIds.splice(index, 1)
}

// ========== 生命周期 ==========
onMounted(async () => {
  await loadCharacters()
  await loadTeams()
})
</script>

<style scoped>
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.provider-card {
  min-height: 140px;
}

.delete-btn {
  border-radius: 4px;
}

.delete-btn:hover {
  background-color: rgba(239, 68, 68, 0.1);
}
</style>
