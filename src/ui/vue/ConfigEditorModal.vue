<template>
	<n-modal
		v-model:show="showModal"
		preset="card"
		:title="modalTitle"
		:style="{ width: '700px', maxWidth: '95vw' }"
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

					<n-alert v-if="validationErrors.length > 0" type="error" :title="validationErrors.length + ' 个错误'">
						<n-ul>
							<n-li v-for="(err, idx) in validationErrors" :key="idx">{{ err }}</n-li>
						</n-ul>
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
				<n-space>
					<n-checkbox v-model:checked="createPR">创建 Pull Request</n-checkbox>
				</n-space>
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
		:style="{ width: '400px' }"
	>
		<n-space vertical :size="12" align="center">
			<n-progress type="line" :percentage="progressPercent" status="success" />
			<n-text>{{ progressMessage }}</n-text>
		</n-space>
	</n-modal>

	<n-modal
		v-model:show="showResult"
		preset="card"
		:title="resultSuccess ? '保存成功' : '保存失败'"
		:style="{ width: '400px' }"
	>
		<n-result
			:status="resultSuccess ? 'success' : 'error'"
			:title="resultSuccess ? '保存成功' : '保存失败'"
		>
			<template #footer>
				<n-space justify="center">
					<n-button v-if="resultSuccess && prUrl" type="primary" tag="a" :href="prUrl" target="_blank">
						查看 PR #{{ prNumber }}
					</n-button>
					<n-button @click="onResultClose">关闭</n-button>
				</n-space>
			</template>
		</n-result>
	</n-modal>
</template>

<script setup lang="ts">
import { ref, computed, h } from 'vue';
import {
	NModal,
	NTabs,
	NTabPane,
	NSpace,
	NForm,
	NFormItem,
	NSelect,
	NInput,
	NInputGroup,
	NInputGroupLabel,
	NInputNumber,
	NSwitch,
	NDynamicInput,
	NButton,
	NAlert,
	NEmpty,
	NDivider,
	NProgress,
	NResult,
	NText,
	NIcon as NIconComponent,
	NCheckbox,
	create,
} from 'naive-ui';

const NIcon = (props: { children?: any }) => {
	return h(NIconComponent, null, { default: () => props.children });
};

interface ConfigOption {
	label: string;
	value: string;
}

interface ConfigEditorAPI {
	fetchConfig: (type: string) => Promise<string | null>;
	fetchFileContent: (path: string) => Promise<string | null>;
	updateConfig: (type: string, content: string, options: any) => Promise<any>;
	updateFileFrontmatter: (path: string, updates: Record<string, any>, options: any) => Promise<any>;
	validateConfig: (type: string, content: string) => { valid: boolean; errors: string[] };
	getConfigPath: (type: string) => string;
	getConfigTitle: (type: string) => string;
	getConfigList: () => Promise<{ type: string; path: string; title: string }[]>;
	parseFrontmatter: (content: string) => { data: Record<string, any>; body: string } | null;
	validatePermalink: (permalink: string) => { valid: boolean; errors: string[] };
}

const props = defineProps<{
	api: ConfigEditorAPI;
	pluginName: string;
}>();

const emit = defineEmits<{
	(e: 'close'): void;
	(e: 'saved'): void;
}>();

const showModal = ref(true);
const tabValue = ref('config');

const selectedConfigType = ref('pathmap');
const configContent = ref('');
const currentConfigPath = ref('');
const loading = ref(false);
const validationErrors = ref<string[]>([]);

const frontmatterFilePath = ref('');
const frontmatterData = ref<Record<string, any> | null>(null);
const loadingFrontmatter = ref(false);
const fmValidationErrors = ref<string[]>([]);
const newFmKey = ref('');
const newFmValue = ref('');

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
	if (tabValue.value === 'config') {
		return configContent.value.trim().length > 0 && validationErrors.value.length === 0;
	} else {
		return frontmatterData.value !== null && fmValidationErrors.value.length === 0;
	}
});

const init = async () => {
	const list = await props.api.getConfigList();
	configOptions.value = list.map(c => ({
		label: c.title,
		value: c.type,
	}));

	if (list.length > 0) {
		currentConfigPath.value = list[0].path;
		await loadConfig();
	}
};

const onConfigTypeChange = async (value: string) => {
	selectedConfigType.value = value;
	currentConfigPath.value = props.api.getConfigPath(value);
	await loadConfig();
};

const loadConfig = async () => {
	loading.value = true;
	validationErrors.value = [];

	try {
		const content = await props.api.fetchConfig(selectedConfigType.value);
		if (content !== null) {
			configContent.value = content;
			if (selectedConfigType.value === 'pathmap') {
				try {
					const parsed = JSON.parse(content);
					configContent.value = JSON.stringify(parsed, null, 2);
				} catch {}
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

const loadFrontmatter = async () => {
	if (!frontmatterFilePath.value.trim()) return;

	loadingFrontmatter.value = true;
	fmValidationErrors.value = [];
	frontmatterData.value = null;

	try {
		const content = await props.api.fetchFileContent(frontmatterFilePath.value);
		if (content === null) {
			fmValidationErrors.value = ['无法获取文件内容'];
			return;
		}

		const parsed = props.api.parseFrontmatter(content);
		if (!parsed) {
			fmValidationErrors.value = ['文件不包含有效的 Frontmatter'];
			return;
		}

		frontmatterData.value = { ...parsed.data };

		if (parsed.data.permalink) {
			const permValidation = props.api.validatePermalink(parsed.data.permalink);
			if (!permValidation.valid) {
				fmValidationErrors.value = permValidation.errors;
			}
		}
	} catch (error: any) {
		fmValidationErrors.value = [error.message];
	} finally {
		loadingFrontmatter.value = false;
	}
};

const addFrontmatterField = () => {
	if (!newFmKey.value.trim()) return;

	if (!frontmatterData.value) {
		frontmatterData.value = {};
	}

	frontmatterData.value[newFmKey.value.trim()] = newFmValue.value || '';
	newFmKey.value = '';
	newFmValue.value = '';
};

const onCancel = () => {
	emit('close');
};

const onSave = async () => {
	saving.value = true;
	showProgress.value = true;
	progressPercent.value = 0;
	progressMessage.value = '准备保存...';

	try {
		if (tabValue.value === 'config') {
			const validation = props.api.validateConfig(selectedConfigType.value, configContent.value);
			if (!validation.valid) {
				validationErrors.value = validation.errors;
				showProgress.value = false;
				saving.value = false;
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
		} else {
			if (!frontmatterData.value || !frontmatterFilePath.value) {
				showProgress.value = false;
				saving.value = false;
				return;
			}

			const result = await props.api.updateFileFrontmatter(
				frontmatterFilePath.value,
				frontmatterData.value,
				{
					createPR: createPR.value,
					commitMessage: `更新 Frontmatter via Sillot: ${frontmatterFilePath.value}`,
					onProgress: (percent: number, msg: string) => {
						progressPercent.value = percent;
						progressMessage.value = msg;
					},
				}
			);

			handleResult(result);
		}
	} catch (error: any) {
		handleResult({ success: false, error: error.message });
	} finally {
		saving.value = false;
	}
};

const handleResult = (result: any) => {
	showProgress.value = false;

	if (result.success) {
		resultSuccess.value = true;
		prUrl.value = result.prUrl || '';
		prNumber.value = result.prNumber || null;
	} else {
		resultSuccess.value = false;
		prUrl.value = '';
		prNumber.value = null;
		fmValidationErrors.value = result.error ? [result.error] : [];
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

<style scoped>
.n-input textarea {
	font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
	font-size: 13px;
}
</style>
