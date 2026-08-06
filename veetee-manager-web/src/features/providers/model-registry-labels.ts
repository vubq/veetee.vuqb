import type { ModelType } from '@/domain'

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
