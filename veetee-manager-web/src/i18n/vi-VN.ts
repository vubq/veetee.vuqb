export default {
  app: {
    name: 'Veetee',
    dashboard: 'Bảng điều khiển',
    preview: 'Bản xem trước giao diện',
  },
  nav: {
    assistants: 'Trợ lý',
    components: 'Thư viện giao diện',
  },
  common: {
    save: 'Lưu bản nháp',
    cancel: 'Hủy',
    close: 'Đóng',
    search: 'Tìm kiếm',
    reset: 'Đặt lại dữ liệu mẫu',
    back: 'Quay lại',
  },
  preview: {
    scenario: {
      happy: {
        label: 'Mặc định',
        description: 'Dữ liệu sẵn sàng và mọi mutation thành công.',
      },
      offline: {
        label: 'Ngoại tuyến / stale',
        description: 'Read trả snapshot cũ; mutation bị chặn.',
      },
      revisionConflict: {
        label: 'Xung đột revision',
        description: 'Lưu form mở recovery reload, copy draft hoặc cancel.',
      },
      providerError: {
        label: 'Provider không khả dụng',
        description: 'LLM lỗi và không tự động fallback.',
      },
      longAction: {
        label: 'Tác vụ dài',
        description: 'Mutation giữ loading đủ lâu để quan sát.',
      },
      history: {
        label: 'Có lịch sử',
        description: 'Có một cuộc hội thoại mẫu để kiểm tra chi tiết và keyboard.',
      },
    },
  },
}
