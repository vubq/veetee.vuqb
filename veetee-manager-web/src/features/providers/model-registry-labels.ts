import type { ModelConfigRecord, ModelProviderField, ModelProviderRecord, ModelType } from '@/domain'

export const MODEL_TYPE_ORDER: readonly ModelType[] = ['VAD', 'ASR', 'LLM', 'VLLM', 'Intent', 'TTS', 'Memory', 'RAG', 'Plugin']

export const MODEL_TYPE_LABELS: Record<ModelType, string> = {
  ASR: 'Nhận dạng giọng nói (ASR)',
  TTS: 'Tổng hợp giọng nói (TTS)',
  LLM: 'Mô hình ngôn ngữ (LLM)',
  VLLM: 'Mô hình thị giác (VLLM)',
  Intent: 'Nhận diện ý định (Intent)',
  Memory: 'Bộ nhớ (Memory)',
  VAD: 'Phát hiện giọng nói (VAD)',
  Plugin: 'Plugin / công cụ',
  RAG: 'Kho kiến thức (RAG)',
}

export const MODEL_TYPE_SHORT_LABELS: Record<ModelType, string> = {
  ASR: 'ASR',
  TTS: 'TTS',
  LLM: 'LLM',
  VLLM: 'VLLM',
  Intent: 'Intent',
  Memory: 'Memory',
  VAD: 'VAD',
  Plugin: 'Plugin',
  RAG: 'RAG',
}

export const MODEL_TYPE_DESCRIPTIONS: Record<ModelType, string> = {
  ASR: 'Chuyển lời nói thành văn bản.',
  TTS: 'Đọc câu trả lời thành tiếng.',
  LLM: 'Sinh câu trả lời và gọi công cụ.',
  VLLM: 'Hiểu hình ảnh khi provider hỗ trợ.',
  Intent: 'Phân loại yêu cầu đặc biệt.',
  Memory: 'Quản lý ngữ cảnh hội thoại.',
  VAD: 'Nhận biết lúc bắt đầu và dừng nói.',
  Plugin: 'Kết nối công cụ và MCP.',
  RAG: 'Tìm thông tin từ kho kiến thức.',
}

export function normalizeModelSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLocaleLowerCase('vi')
}

export function formatFieldType(type: string): string {
  return ({
    string: 'Chuỗi',
    number: 'Số',
    boolean: 'Bật/tắt',
    password: 'Bí mật',
    dict: 'Đối tượng',
    array: 'Danh sách',
    int: 'Số nguyên',
    integer: 'Số nguyên',
    float: 'Số thực',
  } as Record<string, string>)[type] ?? type
}

const CJK_RE = /[\u3400-\u9fff]/u

/**
 * The source catalog is intentionally kept wire/data-compatible with the
 * upstream registry, which means some historical names and field labels are
 * Chinese.  The Manager surface is Vietnamese-first, so localization belongs
 * at the presentation boundary rather than mutating provider/model codes.
 */
const FIELD_KEY_LABELS: Record<string, string> = {
  type: 'Loại cấu hình',
  modelPath: 'Đường dẫn model',
  model_dir: 'Thư mục model',
  output_dir: 'Thư mục đầu ra',
  device: 'Thiết bị tính toán',
  computeType: 'Kiểu tính toán',
  cpuThreads: 'Số luồng CPU',
  numWorkers: 'Số worker',
  sampleRate: 'Sample rate',
  sourceSampleRate: 'Sample rate nguồn',
  beamSize: 'Beam size',
  vadFilter: 'Lọc VAD trong ASR',
  threshold: 'Ngưỡng phát hiện',
  min_silence_duration_ms: 'Thời lượng im lặng tối thiểu (ms)',
  base_url: 'URL cơ sở',
  api_url: 'URL API',
  api_key: 'Khóa API',
  apiKey: 'Khóa API',
  secret_ref: 'Tham chiếu bí mật',
  secretRefs: 'Tham chiếu bí mật',
  model_name: 'Tên model',
  model: 'Model',
  modelId: 'ID model',
  model_id: 'ID model',
  voice: 'Giọng đọc',
  voiceId: 'ID giọng đọc',
  voice_id: 'ID giọng đọc',
  backboneRepo: 'Kho backbone',
  mode: 'Chế độ',
  dtype: 'Kiểu dữ liệu',
  prewarm: 'Nạp model khi khởi động',
  stream: 'Streaming',
  tool_choice: 'Cách chọn công cụ',
  temperature: 'Temperature',
  max_tokens: 'Số token tối đa',
  top_p: 'Top-p',
  top_k: 'Top-k',
  frequency_penalty: 'Phạt lặp từ',
  access_token: 'Token truy cập',
  token: 'Token truy cập',
  appid: 'ID ứng dụng',
  app_id: 'ID ứng dụng',
  access_key: 'Access key',
  access_key_id: 'ID access key',
  secret_key: 'Secret key',
  secret_id: 'Secret ID',
  endpoint: 'Địa chỉ dịch vụ',
  host: 'Địa chỉ máy chủ',
  port: 'Cổng dịch vụ',
  language: 'Ngôn ngữ',
  locale: 'Ngôn ngữ',
  config: 'Cấu hình',
}

function humanizeIdentifier(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_.-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function containsCjk(value: string): boolean {
  return CJK_RE.test(value)
}

export function localizedFieldLabel(field: Pick<ModelProviderField, 'key' | 'label'>): string {
  const known = FIELD_KEY_LABELS[field.key]
  if (known) return known
  if (!containsCjk(field.label) && field.label.trim()) return field.label
  const fallback = humanizeIdentifier(field.key)
  return fallback ? `Trường ${fallback}` : 'Trường cấu hình'
}

export function localizedProviderName(provider: Pick<ModelProviderRecord, 'modelType' | 'providerCode' | 'name'>): string {
  if (!containsCjk(provider.name) && provider.name.trim()) return provider.name
  const code = humanizeIdentifier(provider.providerCode)
  return code ? `Nhà cung cấp · ${code}` : `Nhà cung cấp ${MODEL_TYPE_SHORT_LABELS[provider.modelType]}`
}

export function localizedModelName(model: Pick<ModelConfigRecord, 'modelType' | 'modelCode' | 'modelName'>): string {
  if (!containsCjk(model.modelName) && model.modelName.trim()) return model.modelName
  const code = humanizeIdentifier(model.modelCode)
  return code ? `Mô hình · ${code}` : `Mô hình ${MODEL_TYPE_SHORT_LABELS[model.modelType]}`
}
