<template>
  <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
    <div v-for="account in subAccounts" :key="account.id"
      class="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer relative">
      <div class="flex flex-col items-center text-center pt-4">
        <div class="w-16 h-16 mb-3 flex items-center justify-center">
          <Avatar :src="account.avatar_url" type="user" round />
        </div>
        <h3 class="font-medium text-gray-900 truncate w-full">{{ account.nickname }}</h3>
        <p class="text-sm text-gray-500 truncate w-full mt-1">{{ account.email }}</p>
      </div>
      <div class="absolute bottom-2 right-2">
        <n-dropdown :options="dropdownOptions" @select="(key) => handleDropdownSelect(key, account)" trigger="hover">
          <UiButton text>
            <MoreVertOutlined class="h-5 w-5 text-gray-500" />
          </UiButton>
        </n-dropdown>
      </div>
    </div>
    <div
      class="border border-gray-300 rounded-lg p-4 flex items-center justify-center hover:shadow-md transition-shadow cursor-pointer bg-gray-50"
      @click="handleAddAccount">
      <div class="flex flex-col items-center">
        <div class="w-16 h-16 rounded-full bg-gray-200 mb-3 flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-gray-500" fill="none" viewBox="0 0 24 24"
            stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>
        <span class="text-gray-500 font-medium">添加账户</span>
      </div>
    </div>
  </div>

  <!-- 子账户编辑/新增模态框 -->
  <n-modal v-model:show="showAccountModal" preset="card" style="width: 500px;" :title="modalTitle">
    <n-form ref="accountFormRef" :model="accountForm" :rules="accountFormRules" label-placement="top">
      <n-form-item label="昵称" path="nickname">
        <n-input v-model:value="accountForm.nickname" placeholder="请输入昵称" />
      </n-form-item>
      <n-form-item label="邮箱" path="email">
        <n-input v-model:value="accountForm.email" placeholder="请输入邮箱" />
      </n-form-item>
      <n-form-item label="密码" path="password">
        <n-input v-model:value="accountForm.password" type="password" show-password-on="click" placeholder="请输入密码" />
      </n-form-item>
      <n-form-item v-if="isAddingAccount" label="确认密码" path="confirmPassword">
        <n-input v-model:value="accountForm.confirmPassword" type="password" show-password-on="click"
          placeholder="请再次输入密码" />
      </n-form-item>
    </n-form>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UiButton @click="showAccountModal = false">取消</UiButton>
        <UiButton type="primary" @click="saveAccount">保存</UiButton>
      </div>
    </template>
  </n-modal>
</template>

<script setup>
import { ref, computed, onMounted, h } from 'vue'
import { NForm, NFormItem, NInput, NIcon, NDropdown, NModal } from 'naive-ui'
import { MoreVertOutlined, EditOutlined, DeleteOutlineOutlined } from '@vicons/material'
import { usePopup } from '../../composables/usePopup'
import { apiService } from '../../services/ApiService'
import { UiButton, Avatar } from '../ui/'

const { toast } = usePopup()

// 子账户数据
const subAccounts = ref([])

// 子账户表单相关
const showAccountModal = ref(false)
const isAddingAccount = ref(false)
const editingAccount = ref(null)
const accountFormRef = ref(null)

const accountForm = ref({
  nickname: '',
  email: '',
  password: '',
  confirmPassword: ''
})

const accountFormRules = computed(() => {
  const rules = {
    nickname: [
      { required: true, message: '请输入昵称', trigger: 'blur' }
    ],
    email: [
      { required: true, message: '请输入邮箱', trigger: 'blur' },
      { type: 'email', message: '请输入正确的邮箱地址', trigger: 'blur' }
    ],
  }

  // 新增账户时需要确认密码
  if (isAddingAccount.value) {
    rules.password = [
      { required: true, message: '请输入密码', trigger: 'blur' },
      { min: 6, message: '密码长度不能少于6位', trigger: 'blur' }
    ]
    rules.confirmPassword = [
      { required: true, message: '请确认密码', trigger: 'blur' },
      {
        validator: (rule, value) => {
          return value === accountForm.value.password || '两次输入的密码不一致'
        },
        trigger: 'blur'
      }
    ]
  } else {
    rules.password = [
      { min: 6, message: '密码长度不能少于6位', trigger: 'blur' }
    ]
  }

  return rules
})

const modalTitle = computed(() => {
  return isAddingAccount.value ? '新增子账户' : '编辑子账户'
})

// 下拉菜单选项
const dropdownOptions = [
  {
    label: '编辑',
    key: 'edit',
    icon: () => h(NIcon, null, { default: () => h(EditOutlined) })
  },
  {
    label: '删除',
    key: 'delete',
    icon: () => h(NIcon, null, { default: () => h(DeleteOutlineOutlined) })
  }
]

// 添加处理添加账户的方法
const handleAddAccount = () => {
  isAddingAccount.value = true
  editingAccount.value = null
  accountForm.value = {
    nickname: '',
    email: '',
    password: '',
    confirmPassword: ''
  }
  showAccountModal.value = true
}

// 处理下拉菜单选择
const handleDropdownSelect = (key, account) => {
  switch (key) {
    case 'edit':
      // 编辑账户
      isAddingAccount.value = false
      editingAccount.value = account
      accountForm.value = {
        nickname: account.nickname,
        email: account.email,
        password: '',
        confirmPassword: ''
      }
      showAccountModal.value = true
      break
    case 'delete':
      apiService.deleteSubaccount(account.id).then(() => {
        toast.success('账户删除成功')
        subAccounts.value = subAccounts.value.filter(acc => acc.id !== account.id)
      }).catch(() => {
        toast.error('账户删除失败')
      })
      break
  }
}

const saveAccount = () => {
  accountFormRef.value?.validate(async (errors) => {
    if (!errors) {
      try {
        if (isAddingAccount.value) {
          // 新增账户逻辑
          const newAccount = {
            nickname: accountForm.value.nickname,
            email: accountForm.value.email,
            password: accountForm.value.password
          }

          const response = await apiService.createSubaccount(newAccount);

          subAccounts.value.push(response)
          toast.success('账户添加成功')
        } else {
          // 编辑账户逻辑
          const index = subAccounts.value.findIndex(acc => acc.id === editingAccount.value.id)
          if (index !== -1) {
            subAccounts.value[index].nickname = accountForm.value.nickname
            subAccounts.value[index].email = accountForm.value.email

            let data = {
              nickname: accountForm.value.nickname,
              email: accountForm.value.email,
            }
            if (accountForm.value.password) {
              data.password = accountForm.value.password
            }
            await apiService.updateSubaccount(editingAccount.value.id, data)
            toast.success('账户编辑成功')
          }
        }
      } catch (error) {
        toast.error(error.message)
      }

      showAccountModal.value = false
    }
  })
}

const loadSubAccounts = async () => {
  try {
    const response = await apiService.fetchSubaccounts();
    subAccounts.value = response.items
  } catch (error) {
    toast.error('加载子账户失败')
  }
}

defineExpose({
  loadSubAccounts
})

onMounted(() => {
  loadSubAccounts()
})
</script>