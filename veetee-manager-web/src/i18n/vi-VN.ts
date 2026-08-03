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
  auth: {
    eyebrow: 'Không gian quản trị',
    title: 'Đăng nhập',
    description: 'Đăng nhập để quản lý trợ lý, provider và thiết bị Veetee.',
    email: 'Email',
    emailPlaceholder: 'owner@example.com',
    password: 'Mật khẩu',
    passwordPlaceholder: 'Nhập mật khẩu',
    submit: 'Vào Manager',
    logout: 'Đăng xuất',
    previewNote: 'Đang chạy UI preview: bạn có thể bỏ qua bước này.',
    errors: {
      invalidCredentials: 'Email hoặc mật khẩu chưa đúng.',
      throttled: 'Bạn thử đăng nhập quá nhiều lần. Hãy chờ rồi thử lại.',
      network: 'Không kết nối được Manager API. Kiểm tra service hoặc mạng LAN.',
      preview: 'UI preview không yêu cầu đăng nhập.',
      generic: 'Đăng nhập chưa thành công. Hãy thử lại.',
    },
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
