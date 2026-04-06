<template>
  <div v-if="authLoading" class="auth-shell">
    <n-spin size="large" />
  </div>

  <div v-else-if="!isAuthenticated" class="auth-shell">
    <n-card class="login-card" title="后台登录" size="small">
      <n-form label-placement="top">
        <n-form-item label="用户名">
          <n-input
            v-model:value="loginForm.username"
            placeholder="请输入用户名"
            @keyup.enter="handleLogin"
          />
        </n-form-item>
        <n-form-item label="密码">
          <n-input
            v-model:value="loginForm.password"
            type="password"
            show-password-on="click"
            placeholder="请输入密码"
            @keyup.enter="handleLogin"
          />
        </n-form-item>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button type="primary" :loading="loginLoading" @click="handleLogin">登录</n-button>
        </n-space>
      </template>
    </n-card>
  </div>

  <div v-else class="page">
    <section class="hero">
      <div>
        <p class="hero-badge">Cloudflare Worker + D1</p>
        <h1>账号管理与上传中心</h1>
        <p>
          管理账号、批量导入、配置上传模板，并按你给定的占位符格式发送到目标接口。
        </p>
      </div>
      <n-space align="center" class="hero-actions">
        <n-tag type="success" size="small">已登录：{{ currentUser }}</n-tag>
        <n-button quaternary :loading="logoutLoading" @click="handleLogout">退出登录</n-button>
      </n-space>
    </section>

    <n-tabs v-model:value="activeTab" type="segment" animated>
      <n-tab-pane name="accounts" tab="账号管理">
        <n-space vertical size="large">
          <n-card title="新增账号" size="small">
            <n-grid :x-gap="12" :y-gap="12" :cols="24">
              <n-gi :span="6">
                <n-form-item label="账号">
                  <n-input v-model:value="createForm.account" placeholder="请输入账号" />
                </n-form-item>
              </n-gi>
              <n-gi :span="6">
                <n-form-item label="密码">
                  <n-input
                    v-model:value="createForm.password"
                    type="password"
                    show-password-on="click"
                    placeholder="请输入密码"
                  />
                </n-form-item>
              </n-gi>
              <n-gi :span="6">
                <n-form-item label="Client ID（可选）">
                  <n-input v-model:value="createForm.clientId" placeholder="client_id" />
                </n-form-item>
              </n-gi>
              <n-gi :span="6">
                <n-form-item label="Refresh Token（可选）">
                  <n-input v-model:value="createForm.refreshToken" placeholder="refresh_token" />
                </n-form-item>
              </n-gi>
              <n-gi :span="24">
                <n-form-item label="备注（可选）">
                  <n-input v-model:value="createForm.remark" placeholder="备注信息" />
                </n-form-item>
              </n-gi>
            </n-grid>
            <n-space justify="end">
              <n-button type="primary" :loading="createLoading" @click="handleCreateAccount">
                保存账号
              </n-button>
            </n-space>
          </n-card>

          <n-card title="批量导入" size="small">
            <n-input
              v-model:value="importText"
              type="textarea"
              :autosize="{ minRows: 5, maxRows: 9 }"
              placeholder="每行一个账号：账号----密码 或 账号----密码----client_id----refresh_token"
            />
            <template #footer>
              <n-space justify="space-between" align="center">
                <span class="hint">支持你截图里的占位格式，空行会自动忽略。</span>
                <n-button type="primary" secondary :loading="importLoading" @click="handleImport">
                  导入账号
                </n-button>
              </n-space>
            </template>
          </n-card>

          <n-card title="账号列表" size="small">
            <n-space justify="space-between" align="center" style="margin-bottom: 12px">
              <n-input
                v-model:value="searchKeyword"
                clearable
                style="max-width: 340px"
                placeholder="按账号或备注搜索"
                @keyup.enter="loadAccounts"
              />
              <n-space>
                <n-tag type="info" size="small">已选 {{ checkedRowKeys.length }} 条</n-tag>
                <n-button :loading="tableLoading" @click="loadAccounts">刷新</n-button>
              </n-space>
            </n-space>

            <n-data-table
              :columns="accountColumns"
              :data="accounts"
              :row-key="rowKey"
              :loading="tableLoading"
              :checked-row-keys="checkedRowKeys"
              :pagination="{ pageSize: 10 }"
              max-height="520"
              @update:checked-row-keys="handleCheckedRowKeysUpdate"
            />
          </n-card>
        </n-space>
      </n-tab-pane>

      <n-tab-pane name="upload" tab="上传配置">
        <n-space vertical size="large">
          <n-card title="上传接口配置" size="small">
            <n-form label-placement="top">
              <n-grid :x-gap="12" :y-gap="12" :cols="24">
                <n-gi :span="24">
                  <n-form-item label="上传 URL">
                    <n-input
                      v-model:value="uploadConfig.url"
                      placeholder="例如：https://api.example.com/upload"
                    />
                  </n-form-item>
                </n-gi>
                <n-gi :span="8">
                  <n-form-item label="请求方法">
                    <n-select
                      v-model:value="uploadConfig.method"
                      :options="methodOptions"
                      placeholder="选择请求方法"
                    />
                  </n-form-item>
                </n-gi>
                <n-gi :span="16">
                  <n-form-item label="Content-Type">
                    <n-input
                      v-model:value="uploadConfig.contentType"
                      placeholder="application/json"
                    />
                  </n-form-item>
                </n-gi>
                <n-gi :span="8">
                  <n-form-item label="并发数（1-10）">
                    <n-input-number
                      style="width: 100%"
                      :value="uploadConfig.concurrency"
                      :min="1"
                      :max="10"
                      :precision="0"
                      @update:value="updateConcurrency"
                    />
                  </n-form-item>
                </n-gi>
                <n-gi :span="8">
                  <n-form-item label="重试次数（0-5）">
                    <n-input-number
                      style="width: 100%"
                      :value="uploadConfig.retryCount"
                      :min="0"
                      :max="5"
                      :precision="0"
                      @update:value="updateRetryCount"
                    />
                  </n-form-item>
                </n-gi>
                <n-gi :span="8">
                  <n-form-item label="重试间隔（ms）">
                    <n-input-number
                      style="width: 100%"
                      :value="uploadConfig.retryDelayMs"
                      :min="0"
                      :max="10000"
                      :precision="0"
                      @update:value="updateRetryDelay"
                    />
                  </n-form-item>
                </n-gi>
                <n-gi :span="24">
                  <n-form-item label="请求头（JSON 格式，可留空）">
                    <n-input
                      v-model:value="uploadConfig.headers"
                      type="textarea"
                      :autosize="{ minRows: 4, maxRows: 8 }"
                      placeholder='例如：{"Authorization":"Bearer token123"}'
                    />
                  </n-form-item>
                </n-gi>
                <n-gi :span="24">
                  <n-form-item label="数据模板（JSON 格式）">
                    <n-input
                      v-model:value="uploadConfig.template"
                      type="textarea"
                      :autosize="{ minRows: 6, maxRows: 12 }"
                    />
                  </n-form-item>
                </n-gi>
              </n-grid>
            </n-form>

            <n-space justify="end">
              <n-button type="primary" :loading="saveConfigLoading" @click="handleSaveUploadConfig">
                保存上传配置
              </n-button>
            </n-space>
          </n-card>

          <n-card title="占位符说明" size="small">
            <n-code :code="placeholderDoc" language="json" word-wrap />
          </n-card>

          <n-card title="执行上传" size="small">
            <n-space justify="space-between" align="center" wrap>
              <div>
                <p class="hint">已勾选账号：{{ checkedRowKeys.length }} 条</p>
                <p class="hint">上传选中时只上传勾选行；上传全部时忽略勾选状态。</p>
                <p class="hint">
                  当前策略：并发 {{ uploadConfig.concurrency }}，重试 {{ uploadConfig.retryCount }} 次，间隔
                  {{ uploadConfig.retryDelayMs }}ms。
                </p>
              </div>
              <n-space>
                <n-button :loading="uploadLoading" @click="handleExecuteUpload(false)">
                  上传选中账号
                </n-button>
                <n-button type="primary" :loading="uploadLoading" @click="handleExecuteUpload(true)">
                  上传全部账号
                </n-button>
              </n-space>
            </n-space>

            <n-divider />

            <n-empty v-if="!uploadResult" description="暂无上传记录" />
            <div v-else class="upload-result">
              <n-alert :type="uploadResult.failure === 0 ? 'success' : 'warning'" show-icon>
                本次上传 {{ uploadResult.total }} 条，成功 {{ uploadResult.success }} 条，失败
                {{ uploadResult.failure }} 条。
              </n-alert>
              <n-data-table
                :columns="uploadColumns"
                :data="uploadResult.details"
                :pagination="{ pageSize: 8 }"
                max-height="360"
                style="margin-top: 12px"
              />
            </div>
          </n-card>
        </n-space>
      </n-tab-pane>
    </n-tabs>

    <n-modal v-model:show="editVisible" preset="card" title="编辑账号" style="max-width: 760px">
      <n-form label-placement="top">
        <n-grid :x-gap="12" :y-gap="12" :cols="24">
          <n-gi :span="12">
            <n-form-item label="账号">
              <n-input v-model:value="editForm.account" />
            </n-form-item>
          </n-gi>
          <n-gi :span="12">
            <n-form-item label="密码">
              <n-input v-model:value="editForm.password" type="password" show-password-on="click" />
            </n-form-item>
          </n-gi>
          <n-gi :span="12">
            <n-form-item label="Client ID">
              <n-input v-model:value="editForm.clientId" />
            </n-form-item>
          </n-gi>
          <n-gi :span="12">
            <n-form-item label="Refresh Token">
              <n-input v-model:value="editForm.refreshToken" />
            </n-form-item>
          </n-gi>
          <n-gi :span="24">
            <n-form-item label="备注">
              <n-input v-model:value="editForm.remark" />
            </n-form-item>
          </n-gi>
        </n-grid>
      </n-form>
      <template #footer>
        <n-space justify="end">
          <n-button @click="editVisible = false">取消</n-button>
          <n-button type="primary" :loading="editLoading" @click="handleUpdateAccount">保存修改</n-button>
        </n-space>
      </template>
    </n-modal>
  </div>
</template>

<script setup lang="ts">
import { h, onMounted, reactive, ref } from 'vue';
import {
  NAlert,
  NButton,
  NCard,
  NCode,
  NDataTable,
  NDivider,
  NEmpty,
  NForm,
  NFormItem,
  NGi,
  NGrid,
  NInput,
  NInputNumber,
  NModal,
  NSelect,
  NSpace,
  NSpin,
  NTabPane,
  NTabs,
  NTag,
  createDiscreteApi,
  type DataTableColumns
} from 'naive-ui';
import { api, UnauthorizedError } from './api';
import type {
  AccountItem,
  AccountPayload,
  UploadConfig,
  UploadMethod,
  UploadResult,
  UploadResultDetail
} from './types';

const { message } = createDiscreteApi(['message']);

const authLoading = ref(true);
const loginLoading = ref(false);
const logoutLoading = ref(false);
const isAuthenticated = ref(false);
const currentUser = ref('');

const loginForm = reactive({
  username: 'admin',
  password: ''
});

const activeTab = ref<'accounts' | 'upload'>('accounts');

const accounts = ref<AccountItem[]>([]);
const searchKeyword = ref('');
const checkedRowKeys = ref<number[]>([]);

const tableLoading = ref(false);
const createLoading = ref(false);
const editLoading = ref(false);
const importLoading = ref(false);
const saveConfigLoading = ref(false);
const uploadLoading = ref(false);

const importText = ref('');

const createForm = reactive<Required<AccountPayload>>({
  account: '',
  password: '',
  clientId: '',
  refreshToken: '',
  remark: ''
});

const editVisible = ref(false);
const editForm = reactive<Required<AccountPayload> & { id: number | null }>({
  id: null,
  account: '',
  password: '',
  clientId: '',
  refreshToken: '',
  remark: ''
});

const uploadConfig = reactive<UploadConfig>({
  url: '',
  method: 'POST',
  contentType: 'application/json',
  headers: '{}',
  template: '{"a":"_account_","p":"_password_"}',
  retryCount: 2,
  concurrency: 3,
  retryDelayMs: 600
});

const uploadResult = ref<UploadResult | null>(null);

const placeholderDoc = `{
  "data": "captchaurn",
  "a": "_account_",
  "p": "_password_",
  "c": "_id_",
  "t": "_token_"
}

说明：
- _account_ 账号
- _password_ 密码
- _id_ client_id
- _token_ refresh_token
- captchaurn => 账号----密码 或 账号----密码----client_id----refresh_token

例如只要账号和密码：
{"a":"_account_","p":"_password_"}`;

const methodOptions: Array<{ label: UploadMethod; value: UploadMethod }> = [
  { label: 'POST', value: 'POST' },
  { label: 'PUT', value: 'PUT' },
  { label: 'PATCH', value: 'PATCH' }
];

const rowKey = (row: AccountItem): number => row.id;

const accountColumns: DataTableColumns<AccountItem> = [
  { type: 'selection' },
  { title: '账号', key: 'account', minWidth: 130 },
  { title: '密码', key: 'password', minWidth: 130 },
  {
    title: 'Client ID',
    key: 'clientId',
    minWidth: 150,
    render: (row) => row.clientId ?? '-'
  },
  {
    title: 'Refresh Token',
    key: 'refreshToken',
    minWidth: 180,
    ellipsis: { tooltip: true },
    render: (row) => row.refreshToken ?? '-'
  },
  {
    title: '备注',
    key: 'remark',
    minWidth: 140,
    render: (row) => row.remark ?? '-'
  },
  { title: '创建时间', key: 'createdAt', minWidth: 165 },
  {
    title: '操作',
    key: 'actions',
    width: 130,
    render: (row) =>
      h('div', { class: 'action-cell' }, [
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            type: 'primary',
            onClick: () => openEditModal(row)
          },
          { default: () => '编辑' }
        ),
        h(
          NButton,
          {
            size: 'small',
            quaternary: true,
            type: 'error',
            onClick: () => handleDeleteAccount(row.id)
          },
          { default: () => '删除' }
        )
      ])
  }
];

const uploadColumns: DataTableColumns<UploadResultDetail> = [
  { title: '账号', key: 'account', minWidth: 130 },
  {
    title: '状态',
    key: 'ok',
    width: 90,
    render: (row) =>
      h(
        NTag,
        {
          size: 'small',
          type: row.ok ? 'success' : 'error'
        },
        { default: () => (row.ok ? '成功' : '失败') }
      )
  },
  { title: 'HTTP', key: 'status', width: 80 },
  { title: '尝试次数', key: 'attempts', width: 90 },
  { title: '响应内容', key: 'response', minWidth: 260, ellipsis: { tooltip: true } }
];

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return '发生未知错误';
}

function clearSessionState(): void {
  isAuthenticated.value = false;
  currentUser.value = '';
  checkedRowKeys.value = [];
  accounts.value = [];
  uploadResult.value = null;
  editVisible.value = false;
}

function handleApiError(error: unknown, showAuthWarning = true): void {
  if (error instanceof UnauthorizedError) {
    clearSessionState();
    if (showAuthWarning) {
      message.warning('登录已过期，请重新登录');
    }
    return;
  }

  message.error(getErrorMessage(error));
}

function clampInteger(value: number | null, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return fallback;
  }

  const normalized = Math.trunc(value);
  if (normalized < min) {
    return min;
  }
  if (normalized > max) {
    return max;
  }
  return normalized;
}

function updateConcurrency(value: number | null): void {
  uploadConfig.concurrency = clampInteger(value, 1, 10, uploadConfig.concurrency || 3);
}

function updateRetryCount(value: number | null): void {
  uploadConfig.retryCount = clampInteger(value, 0, 5, uploadConfig.retryCount || 2);
}

function updateRetryDelay(value: number | null): void {
  uploadConfig.retryDelayMs = clampInteger(value, 0, 10000, uploadConfig.retryDelayMs || 600);
}

function handleCheckedRowKeysUpdate(keys: Array<number | string>): void {
  checkedRowKeys.value = keys
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

function normalizePayload(payload: Required<AccountPayload>): AccountPayload {
  return {
    account: payload.account.trim(),
    password: payload.password.trim(),
    clientId: payload.clientId.trim(),
    refreshToken: payload.refreshToken.trim(),
    remark: payload.remark.trim()
  };
}

function clearCreateForm(): void {
  createForm.account = '';
  createForm.password = '';
  createForm.clientId = '';
  createForm.refreshToken = '';
  createForm.remark = '';
}

function openEditModal(row: AccountItem): void {
  editForm.id = row.id;
  editForm.account = row.account;
  editForm.password = row.password;
  editForm.clientId = row.clientId ?? '';
  editForm.refreshToken = row.refreshToken ?? '';
  editForm.remark = row.remark ?? '';
  editVisible.value = true;
}

async function loadAccounts(): Promise<void> {
  tableLoading.value = true;
  try {
    const response = await api.listAccounts(searchKeyword.value.trim());
    accounts.value = response.items;
    const available = new Set(response.items.map((item) => item.id));
    checkedRowKeys.value = checkedRowKeys.value.filter((id) => available.has(id));
  } catch (error) {
    handleApiError(error);
  } finally {
    tableLoading.value = false;
  }
}

async function loadUploadConfig(): Promise<void> {
  try {
    const response = await api.getUploadConfig();
    uploadConfig.url = response.item.url;
    uploadConfig.method = response.item.method;
    uploadConfig.contentType = response.item.contentType;
    uploadConfig.headers = response.item.headers;
    uploadConfig.template = response.item.template;
    uploadConfig.retryCount = response.item.retryCount;
    uploadConfig.concurrency = response.item.concurrency;
    uploadConfig.retryDelayMs = response.item.retryDelayMs;
  } catch (error) {
    handleApiError(error);
  }
}

async function loadInitialData(): Promise<void> {
  await Promise.all([loadAccounts(), loadUploadConfig()]);
}

async function handleLogin(): Promise<void> {
  const username = loginForm.username.trim();
  const password = loginForm.password;

  if (!username || !password) {
    message.warning('请填写用户名和密码');
    return;
  }

  loginLoading.value = true;
  try {
    const response = await api.login({ username, password });
    isAuthenticated.value = true;
    currentUser.value = response.username;
    await loadInitialData();
    loginForm.password = '';
    message.success('登录成功');
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      message.error(error.message);
    } else {
      message.error(getErrorMessage(error));
    }
  } finally {
    loginLoading.value = false;
  }
}

async function handleLogout(): Promise<void> {
  logoutLoading.value = true;
  try {
    await api.logout();
    message.success('已退出登录');
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) {
      message.error(getErrorMessage(error));
    }
  } finally {
    logoutLoading.value = false;
    clearSessionState();
    loginForm.password = '';
  }
}

async function handleCreateAccount(): Promise<void> {
  const payload = normalizePayload(createForm);
  if (!payload.account || !payload.password) {
    message.warning('账号和密码必填');
    return;
  }

  createLoading.value = true;
  try {
    await api.createAccount(payload);
    clearCreateForm();
    await loadAccounts();
    message.success('账号已保存');
  } catch (error) {
    handleApiError(error);
  } finally {
    createLoading.value = false;
  }
}

async function handleUpdateAccount(): Promise<void> {
  if (!editForm.id) {
    return;
  }

  const payload = normalizePayload(editForm);
  if (!payload.account || !payload.password) {
    message.warning('账号和密码必填');
    return;
  }

  editLoading.value = true;
  try {
    await api.updateAccount(editForm.id, payload);
    editVisible.value = false;
    await loadAccounts();
    message.success('账号已更新');
  } catch (error) {
    handleApiError(error);
  } finally {
    editLoading.value = false;
  }
}

async function handleDeleteAccount(id: number): Promise<void> {
  const confirmed = window.confirm('确认删除该账号？');
  if (!confirmed) {
    return;
  }

  try {
    await api.deleteAccount(id);
    await loadAccounts();
    message.success('账号已删除');
  } catch (error) {
    handleApiError(error);
  }
}

async function handleImport(): Promise<void> {
  const text = importText.value.trim();
  if (!text) {
    message.warning('请先输入导入内容');
    return;
  }

  importLoading.value = true;
  try {
    const result = await api.importAccounts(text);
    await loadAccounts();
    importText.value = '';
    message.success(`导入完成：新增 ${result.inserted}，跳过 ${result.skipped}`);
    if (result.errors.length > 0) {
      message.warning(`有 ${result.errors.length} 行格式错误，已跳过`);
    }
  } catch (error) {
    handleApiError(error);
  } finally {
    importLoading.value = false;
  }
}

async function handleSaveUploadConfig(): Promise<void> {
  saveConfigLoading.value = true;
  try {
    const response = await api.updateUploadConfig({
      url: uploadConfig.url.trim(),
      method: uploadConfig.method,
      contentType: uploadConfig.contentType.trim(),
      headers: uploadConfig.headers.trim(),
      template: uploadConfig.template.trim(),
      retryCount: clampInteger(uploadConfig.retryCount, 0, 5, 2),
      concurrency: clampInteger(uploadConfig.concurrency, 1, 10, 3),
      retryDelayMs: clampInteger(uploadConfig.retryDelayMs, 0, 10000, 600)
    });
    uploadConfig.url = response.item.url;
    uploadConfig.method = response.item.method;
    uploadConfig.contentType = response.item.contentType;
    uploadConfig.headers = response.item.headers;
    uploadConfig.template = response.item.template;
    uploadConfig.retryCount = response.item.retryCount;
    uploadConfig.concurrency = response.item.concurrency;
    uploadConfig.retryDelayMs = response.item.retryDelayMs;
    message.success('上传配置已保存');
  } catch (error) {
    handleApiError(error);
  } finally {
    saveConfigLoading.value = false;
  }
}

async function handleExecuteUpload(uploadAll: boolean): Promise<void> {
  if (!uploadAll && checkedRowKeys.value.length === 0) {
    message.warning('请先勾选账号，或使用“上传全部账号”');
    activeTab.value = 'accounts';
    return;
  }

  uploadLoading.value = true;
  try {
    const result = await api.executeUpload(uploadAll ? undefined : checkedRowKeys.value);
    uploadResult.value = result;
    activeTab.value = 'upload';
    if (result.failure === 0) {
      message.success(`上传成功，共 ${result.success} 条`);
    } else {
      message.warning(`上传完成，失败 ${result.failure} 条`);
    }
  } catch (error) {
    handleApiError(error);
  } finally {
    uploadLoading.value = false;
  }
}

onMounted(async () => {
  authLoading.value = true;
  try {
    const me = await api.getMe();
    isAuthenticated.value = true;
    currentUser.value = me.username;
    await loadInitialData();
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      clearSessionState();
    } else {
      message.error(getErrorMessage(error));
    }
  } finally {
    authLoading.value = false;
  }
});
</script>
