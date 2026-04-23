<script setup lang="ts">
import { ref, computed } from 'vue';
import {
	NModal,
	NTabs,
	NTabPane,
	NSpace,
	NFormItem,
	NSelect,
	NInput,
	NInputGroup,
	NInputGroupLabel,
	NButton,
	NAlert,
	NEmpty,
	NProgress,
	NResult,
	NText,
	NSpin,
	NCheckbox,
} from 'naive-ui';
import type { ConfigEditorAPI } from './naive-ui-helper';
import type { ConfigType } from '../../sync/ConfigEditor';

interface ConfigOption {
	label: string;
	value: string;
}

interface Props {
	api: ConfigEditorAPI;
	pluginName: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
	close: [];
	saved: [];
}>();

const showModal = ref(true);
const tabValue = ref('config');

const selectedConfigType = ref<ConfigType>('pathmap' as ConfigType);
const configContent = ref('');
const originalConfigContent = ref('');
const currentConfigPath = ref('');
const loading = ref(false);
const validationErrors = ref<string[]>([]);

const createPR = ref(true);
const saving = ref(false);
const showProgress = ref(false);
const progressPercent = ref(0);
const progressMessage = ref('');

const showResult = ref(false);
const resultSuccess = ref(false);
const prUrl = ref('');
const prNumber = ref<number | null>(null);

const configOptions = ref<ConfigOption[]>([]);

const modalTitle = computed(() => `编辑配置文件 - ${props.pluginName}`);

const canSave = computed(() => {
	const hasDiff = configContent.value !== originalConfigContent.value;
	if (!hasDiff) return false;
	return configContent.value.trim().length > 0 && validationErrors.value.length === 0;
});

const init = async () => {
	const list = await props.api.getConfigList();
	configOptions.value = list.map(c => ({
		label: c.title,
		value: c.type,
	}));

	if (list.length > 0) {
		selectedConfigType.value = list[0].type as ConfigType;
		currentConfigPath.value = list[0].path;
		await loadConfig();
	}
};

const onConfigTypeChange = async (value: string) => {
	selectedConfigType.value = value as ConfigType;
	currentConfigPath.value = props.api.getConfigPath(value as ConfigType);
	await loadConfig();
};

const loadConfig = async () => {
	loading.value = true;
	validationErrors.value = [];

	try {
		const content = await props.api.fetchConfig(selectedConfigType.value);
		if (content !== null) {
			configContent.value = content;
			originalConfigContent.value = configContent.value;
			if (selectedConfigType.value === ('pathmap' as ConfigType)) {
				try {
					const parsed = JSON.parse(content);
					configContent.value = JSON.stringify(parsed, null, 2);
				} catch { /* 保持原样 */ }
			}
			const validation = props.api.validateConfig(selectedConfigType.value, configContent.value);
			validationErrors.value = validation.errors;
		} else {
			configContent.value = '';
		}
	} catch (error: any) {
		validationErrors.value = [error.message];
	} finally {
		loading.value = false;
	}
};

const onCancel = () => emit('close');

const onSave = async () => {
	saving.value = true;
	showProgress.value = true;
	progressPercent.value = 0;
	progressMessage.value = '准备保存...';

	try {
		const validation = props.api.validateConfig(selectedConfigType.value, configContent.value);
		if (!validation.valid) {
			validationErrors.value = validation.errors;
			return;
		}

		const result = await props.api.updateConfig(
			selectedConfigType.value,
			configContent.value,
			{
				createPR: createPR.value,
				commitMessage: `更新配置文件 via Sillot: ${props.api.getConfigTitle(selectedConfigType.value)}`,
				onProgress: (percent: number, msg: string) => {
					progressPercent.value = percent;
					progressMessage.value = msg;
				},
			}
		);

		handleResult(result);
	} catch (error: any) {
		handleResult({ success: false, error: error.message });
	} finally {
		saving.value = false;
		showProgress.value = false;
	}
};

const handleResult = (result: any) => {
	if (result.success) {
		resultSuccess.value = true;
		prUrl.value = result.prUrl ?? '';
		prNumber.value = result.prNumber ?? null;
		originalConfigContent.value = configContent.value;
	} else {
		resultSuccess.value = false;
		prUrl.value = '';
		prNumber.value = null;
	}
	showResult.value = true;
};

const onResultClose = () => {
	showResult.value = false;
	if (resultSuccess.value) {
		emit('saved');
		emit('close');
	}
};

init();
</script>

<template>
	<n-modal
		v-model:show="showModal"
		preset="card"
		:title="modalTitle"
		class="config-modal"
		:segmented="{ content: true, footer: true }"
	>
		<n-tabs v-model:value="tabValue" type="line" animated>
			<n-tab-pane name="config" tab="配置文件">
				<n-space vertical :size="16">
					<n-form-item label="配置文件" label-placement="left">
						<n-select
							v-model:value="selectedConfigType"
							:options="configOptions"
							placeholder="选择配置文件"
							@update:value="onConfigTypeChange"
						/>
					</n-form-item>

					<n-input-group>
						<n-input-group-label>文件路径</n-input-group-label>
						<n-input :value="currentConfigPath" readonly />
					</n-input-group>

					<n-spin :show="loading">
						<n-input
							v-model:value="configContent"
							type="textarea"
							:placeholder="loading ? '加载中...' : '配置内容'"
							:rows="12"
							:disabled="loading"
						/>
					</n-spin>

					<n-alert
						v-if="validationErrors.length > 0"
						type="error"
						:title="`${validationErrors.length} 个错误`"
					>
						<ul>
							<li v-for="(err, idx) in validationErrors" :key="idx">{{ err }}</li>
						</ul>
					</n-alert>
				</n-space>
			</n-tab-pane>

			<n-tab-pane name="assets" tab="附件管理">
				<n-space vertical :size="16">
					<n-empty description="附件管理功能请使用配置编辑器弹窗" />
				</n-space>
			</n-tab-pane>
		</n-tabs>

		<template #footer>
			<n-space justify="space-between">
				<n-checkbox v-model:checked="createPR">创建 Pull Request</n-checkbox>
				<n-space>
					<n-button @click="onCancel">取消</n-button>
					<n-button
						type="primary"
						:loading="saving"
						:disabled="!canSave"
						@click="onSave"
					>
						保存
					</n-button>
				</n-space>
			</n-space>
		</template>
	</n-modal>

	<n-modal
		v-model:show="showProgress"
		preset="card"
		title="保存中..."
		:closable="false"
		:mask-closable="false"
		class="progress-modal"
	>
		<n-space vertical :size="12" align="center">
			<n-progress type="line" :percentage="progressPercent" status="success" />
			<n-text>{{ progressMessage }}</n-text>
		</n-space>
	</n-modal>

	<n-modal
		v-model:show="showResult"
		preset="card"
		:title="resultSuccess ? (createPR ? 'PR 成功' : '保存成功') : '保存失败'"
		class="result-modal"
	>
		<n-result
			:status="resultSuccess ? 'success' : 'error'"
			:title="resultSuccess ? (createPR ? 'PR 创建成功' : '保存成功') : '保存失败'"
		>
			<template #footer>
				<n-space justify="center">
					<n-button
						v-if="resultSuccess && prUrl"
						type="primary"
						tag="a"
						:href="prUrl"
						target="_blank"
					>
						查看 PR #{{ prNumber }}
					</n-button>
					<n-button @click="onResultClose">关闭</n-button>
				</n-space>
			</template>
		</n-result>
	</n-modal>
</template>

<style scoped>
.config-modal {
	width: 700px;
	max-width: 95vw;
}

.progress-modal,
.result-modal {
	width: 400px;
}

:deep(.n-input textarea) {
	font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
	font-size: 13px;
}
</style>
