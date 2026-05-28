<template>
  <el-dialog
    v-model="visible"
    title="工作目录设置"
    width="500px"
    :close-on-click-modal="false"
  >
    <div class="space-y-4">
      <p class="text-sm text-gray-600 dark:text-gray-400">
        {{ allowEmpty ? '设置当前会话的工作目录路径。留空则使用系统默认目录。' : '更换当前会话的工作目录路径。' }}
      </p>
      
      <el-form label-position="top">
        <el-form-item label="工作目录路径">
          <div class="flex gap-2 w-full">
            <el-input
              v-model="workspacePath"
              placeholder="例如：D:\Projects\MyProject（留空使用默认目录）"
              clearable
            />
            <el-button @click="selectFolder" type="primary" plain>
              选择文件夹
            </el-button>
          </div>
        </el-form-item>
        <div class="-mt-4 mb-2 text-xs text-gray-500 dark:text-gray-400">
          <div>• 必须使用绝对路径</div>
          <div>• 请确保该目录有读写权限</div>
        </div>
      </el-form>
    </div>
    
    <template #footer>
      <div class="flex justify-end gap-2">
        <el-button @click="handleCancel">取消</el-button>
        <el-button type="primary" @click="handleConfirm">确定</el-button>
      </div>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { ElMessage } from 'element-plus';

const props = defineProps<{
  visible: boolean;
  currentWorkspacePath?: string | null;
  // 是否允许设置为空（工作目录窗格不允许为空，创建会话时允许）
  allowEmpty?: boolean;
}>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  'confirm': [workspacePath: string | null];
}>();

const workspacePath = ref<string>('');

// 监听弹窗打开，初始化路径值
watch(() => props.visible, (newVal) => {
  if (newVal) {
    workspacePath.value = props.currentWorkspacePath || '';
  }
});

const visible = computed({
  get: () => props.visible,
  set: (val) => emit('update:visible', val)
});

const handleCancel = () => {
  visible.value = false;
};

const handleConfirm = () => {
  const trimmedPath = workspacePath.value.trim();

  // 不允许为空时，强制要求输入路径
  if (!props.allowEmpty && !trimmedPath) {
    ElMessage.error('工作目录路径不能为空');
    return;
  }

  // 如果输入了路径，验证是否为绝对路径
  if (trimmedPath) {
    // Windows 和 Unix 系统的绝对路径检查
    const isAbsolute = /^[a-zA-Z]:\\/.test(trimmedPath) || trimmedPath.startsWith('/');

    if (!isAbsolute) {
      ElMessage.error('工作目录必须是绝对路径');
      return;
    }
  }

  emit('confirm', trimmedPath || null);
  visible.value = false;
};

// 选择文件夹
const selectFolder = async () => {
  // 检测是否在 Electron 环境中
  const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;
  
  if (isElectron && (window as any).electronAPI?.selectFolder) {
    try {
      const selectedPath = await (window as any).electronAPI.selectFolder();
      if (selectedPath) {
        workspacePath.value = selectedPath;
        ElMessage.success('已选择文件夹');
      }
    } catch (error) {
      console.error('选择文件夹失败:', error);
      ElMessage.error('选择文件夹失败');
    }
  } else {
    // 非 Electron 环境，提示用户使用文件输入框
    ElMessage.warning('当前环境不支持文件夹选择，请直接输入路径');
  }
};
</script>

<style scoped>
.space-y-4 > * + * {
  margin-top: 1rem;
}
</style>
