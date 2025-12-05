<template>
    <SidebarLayout v-model:sidebar-visible="sidebarVisible" :sidebar-width="220">
        <template #sidebar>
            <div class="flex flex-col h-full border-r border-gray-200 items-center relative p-3">
                <div class="h-12"></div>
                <div class="w-full cursor-pointer h-10 flex items-center justify-center hover:text-[var(--primary-color)] hover:bg-[var(--secondary-color)] px-6 py-3 mb-3 rounded-full transition-colors duration-200"
                    :class="{ 'bg-[var(--secondary-color)] text-[var(--primary-color)]': currentTabValue === item.path }"
                    v-for="item in sidebarItems" @click="handleItemClick(item)">
                    <div class="flex-1 w-full flex items-center gap-x-2">
                        <component :is="item.icon" class="w-5 h-5"></component>
                        <span class="text-md">{{ item.label }}</span>
                    </div>
                </div>
            </div>
        </template>
        <template #content>
            <div class="w-full h-full flex flex-col bg-[var(--bg)]">
                <div class="rounded-2xl h-full m-0 flex flex-col bg-white p-6">
                    <div class="text-xl font-bold mb-6">{{ currentItem.label }}</div>
                    <template v-if="currentTabValue === '/user/profile'">
                        <div class="max-w-128">
                            <n-form ref="basicFormRef" :model="userForm" :rules="basicRules" label-placement="top"
                                label-width="80px" size="large">
                                <!-- 头像设置 -->
                                <n-form-item label="头像设置" :show-label="false">
                                    <AvatarPreview :src="userForm.avatar_url" :type="'user'"
                                        @avatar-changed="handleAvaterChanged" />
                                </n-form-item>
                                <n-form-item label="昵称" path="nickname">
                                    <n-input v-model:value="userForm.nickname" placeholder="昵称" />
                                </n-form-item>
                                <n-form-item label="邮箱" path="email">
                                    <n-input v-model:value="userForm.email" placeholder="邮箱" />
                                </n-form-item>
                                <n-form-item label="手机号码" path="phone">
                                    <n-input v-model:value="userForm.phone" placeholder="手机号码" />
                                </n-form-item>
                                <n-form-item>
                                    <n-button type="primary" @click="handleSaveUserInfo"
                                        :disabled="!isFormChanged">保存信息</n-button>
                                </n-form-item>
                            </n-form>
                        </div>
                    </template>
                    <template v-else-if="currentTabValue === '/user/subaccounts'">
                        <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                            <div v-for="account in subAccounts" :key="account.id"
                                class="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer relative">
                                <div class="flex flex-col items-center text-center pt-4">
                                    <div
                                        class="w-16 h-16 rounded-full bg-gray-200 mb-3 flex items-center justify-center">
                                        <span class="text-gray-500 text-2xl">{{ account.initials }}</span>
                                    </div>
                                    <h3 class="font-medium text-gray-900 truncate w-full">{{ account.nickname }}</h3>
                                    <p class="text-sm text-gray-500 truncate w-full mt-1">{{ account.email }}</p>
                                </div>
                                <div class="absolute bottom-2 right-2">
                                    <n-dropdown :options="dropdownOptions"
                                        @select="(key) => handleDropdownSelect(key, account)" trigger="hover">
                                        <n-button text>
                                            <MoreVertOutlined class="h-5 w-5 text-gray-500" />
                                        </n-button>
                                    </n-dropdown>
                                </div>
                            </div>
                            <div class="border border-gray-300 rounded-lg p-4 flex items-center justify-center hover:shadow-md transition-shadow cursor-pointer bg-gray-50"
                                @click="handleAddAccount">
                                <div class="flex flex-col items-center">
                                    <div
                                        class="w-16 h-16 rounded-full bg-gray-200 mb-3 flex items-center justify-center">
                                        <svg xmlns="http://www.w3.org/2000/svg" class="h-8 w-8 text-gray-500"
                                            fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                                                d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
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
                                    <n-input v-model:value="accountForm.password" type="password" show-password-on="click" 
                                             placeholder="请输入密码" />
                                </n-form-item>
                                <n-form-item v-if="isAddingAccount" label="确认密码" path="confirmPassword">
                                    <n-input v-model:value="accountForm.confirmPassword" type="password" show-password-on="click" 
                                             placeholder="请再次输入密码" />
                                </n-form-item>
                            </n-form>
                            <template #footer>
                                <div class="flex justify-end gap-2">
                                    <n-button @click="showAccountModal = false">取消</n-button>
                                    <n-button type="primary" @click="saveAccount">保存</n-button>
                                </div>
                            </template>
                        </n-modal>
                    </template>
                    <template v-else-if="currentTabValue === '/user/security'">
                        <div class="max-w-128">
                            <n-form ref="passwordFormRef" :model="passwordForm" :rules="passwordRules"
                                label-placement="top" label-width="80px" size="large">
                                <n-form-item label="原密码" path="oldPassword">
                                    <n-input v-model:value="passwordForm.oldPassword" type="password"
                                        show-password-on="click" placeholder="请输入原密码" />
                                </n-form-item>
                                <n-form-item label="新密码" path="newPassword">
                                    <n-input v-model:value="passwordForm.newPassword" type="password"
                                        show-password-on="click" placeholder="请输入新密码" />
                                </n-form-item>
                                <n-form-item label="确认密码" path="confirmPassword">
                                    <n-input v-model:value="passwordForm.confirmPassword" type="password"
                                        show-password-on="click" placeholder="请再次输入新密码" />
                                </n-form-item>
                                <n-form-item>
                                    <n-button type="primary" @click="handleChangePassword">确认修改</n-button>
                                </n-form-item>
                            </n-form>
                        </div>
                    </template>
                </div>
            </div>
        </template>
    </SidebarLayout>
</template>
<script setup>
import { ref, onMounted, computed, markRaw, watch, h } from 'vue'
import { useDebounceFn } from '@vueuse/core' // 导入防抖函数
import SidebarLayout from '../layout/SidebarLayout.vue'
import AvatarPreview from '../AvatarPreview.vue'
import {
    NButton,
    NForm,
    NFormItem,
    NInput,
    NIcon,
    NDropdown,
    NModal
} from 'naive-ui'

import {
    PersonOutlineOutlined,
    SupervisedUserCircleOutlined,
    VerifiedUserOutlined,
    CloudDownloadOutlined,
    MoreVertOutlined,
    EditOutlined,
    DeleteOutlineOutlined
} from '@vicons/material'

import { useAuthStore } from '../../stores/auth'

import { usePopup } from '../../composables/usePopup'

const { toast, notify } = usePopup()

const authStore = useAuthStore()
const sidebarVisible = ref(true)
const currentTabValue = ref('/user/profile')

const avater_file = ref(null)

const originalUserForm = ref({})

const userForm = ref({
    nickname: '',
    phone: '',
    email: '',
    description: '',
    avatar_url: '',
})

// 添加子账户数据
const subAccounts = ref([
    {
        id: 1,
        initials: 'ZS',
        nickname: '张三',
        email: 'zhangsan@example.com'
    },
    {
        id: 2,
        initials: 'LS',
        nickname: '李四',
        email: 'lisi@example.com'
    },
    {
        id: 3,
        initials: 'WW',
        nickname: '王五',
        email: 'wangwu@example.com'
    },
    {
        id: 4,
        initials: 'ZL',
        nickname: '赵六',
        email: 'zhaoliu@example.com'
    }
])

// 添加密码表单数据
const passwordForm = ref({
    oldPassword: '',
    newPassword: '',
    confirmPassword: ''
})

const passwordFormRef = ref(null)

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
        password: [
            { required: true, message: '请输入密码', trigger: 'blur' },
            { min: 6, message: '密码长度不能少于6位', trigger: 'blur' }
        ]
    }

    // 新增账户时需要确认密码
    if (isAddingAccount.value) {
        rules.confirmPassword = [
            { required: true, message: '请确认密码', trigger: 'blur' },
            { 
                validator: (rule, value) => {
                    return value === accountForm.value.password || '两次输入的密码不一致'
                }, 
                trigger: 'blur' 
            }
        ]
    }

    return rules
})

const modalTitle = computed(() => {
    return isAddingAccount.value ? '新增子账户' : '编辑子账户'
})

const sidebarItems = [
    {
        label: '账户概览',
        path: '/user/profile',
        icon: PersonOutlineOutlined,
    },
    {
        label: '子账户',
        path: '/user/subaccounts',
        icon: SupervisedUserCircleOutlined,
    },
    {
        label: '安全设置',
        path: '/user/security',
        icon: VerifiedUserOutlined,
    },
    {
        label: '模型管理',
        path: '/user/models',
        icon: CloudDownloadOutlined,
    }
]

const currentItem = computed(() => {
    return sidebarItems.find(item => item.path === currentTabValue.value)
})

const handleItemClick = (item) => {
    currentTabValue.value = item.path
}

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
            notify.info({
                title: '删除账户',
                content: `删除账户: ${account.nickname}`
            })
            break
    }
}

const saveAccount = () => {
    accountFormRef.value?.validate((errors) => {
        if (!errors) {
            if (isAddingAccount.value) {
                // 新增账户逻辑
                const newAccount = {
                    id: Date.now(), // 简单生成唯一ID
                    initials: accountForm.value.nickname.substring(0, 2).toUpperCase(),
                    nickname: accountForm.value.nickname,
                    email: accountForm.value.email
                }
                subAccounts.value.push(newAccount)
                toast('账户添加成功')
            } else {
                // 编辑账户逻辑
                const index = subAccounts.value.findIndex(acc => acc.id === editingAccount.value.id)
                if (index !== -1) {
                    subAccounts.value[index].nickname = accountForm.value.nickname
                    subAccounts.value[index].email = accountForm.value.email
                    if (accountForm.value.password) {
                        // 如果输入了密码，则更新密码（实际项目中应加密处理）
                    }
                    toast('账户信息更新成功')
                }
            }
            showAccountModal.value = false
        }
    })
}

const basicRules = ref({
    nickname: [
        {
            required: true,
            message: '请输入昵称',
            trigger: 'blur',
        },
    ],
    email: [
        {
            required: true,
            message: '请输入邮箱',
            trigger: 'blur',
        },
        {
            validator: (rule, value) => {
                return /^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/.test(value) || '请输入正确的邮箱'
            }
        }
    ],
    phone: [
        {
            message: '请输入手机号码',
            trigger: 'blur',
        },
    ],
})

// 添加密码表单验证规则
const passwordRules = ref({
    oldPassword: [
        {
            required: true,
            message: '请输入原密码',
            trigger: 'blur'
        }
    ],
    newPassword: [
        {
            required: true,
            message: '请输入新密码',
            trigger: 'blur'
        },
        {
            min: 6,
            message: '密码长度不能少于6位',
            trigger: 'blur'
        }
    ],
    confirmPassword: [
        {
            required: true,
            message: '请确认新密码',
            trigger: 'blur'
        },
        {
            validator: (rule, value) => {
                return value === passwordForm.value.newPassword || '两次输入的密码不一致'
            },
            trigger: 'blur'
        }
    ]
})

const isFormChanged = computed(() => {
    return (
        userForm.value.nickname !== originalUserForm.value.nickname ||
        userForm.value.phone !== originalUserForm.value.phone ||
        userForm.value.email !== originalUserForm.value.email ||
        avater_file.value !== null
    )
})

const handleAvaterChanged = (file) => {
    avater_file.value = file
}

const handleSaveUserInfo = () => {
    toast('保存成功')
}

// 添加修改密码处理函数
const handleChangePassword = (e) => {
    e.preventDefault()
    passwordFormRef.value?.validate((errors) => {
        if (!errors) {
            // 这里应该调用修改密码的API
            toast('密码修改成功')
            // 重置表单
            passwordForm.value = {
                oldPassword: '',
                newPassword: '',
                confirmPassword: ''
            }
        } else {
            console.log('验证失败', errors)
        }
    })
}

onMounted(() => {
    userForm.value = { ...authStore.user }
    originalUserForm.value = { ...authStore.user }
})
</script>