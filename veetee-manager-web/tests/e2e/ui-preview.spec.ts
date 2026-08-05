import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

const assistantId = '11111111-1111-4111-8111-111111111111'

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

test('tìm kiếm, tạo trợ lý và đặt lại fixture', async ({ page }) => {
  await page.goto('/assistants')
  const search = page.getByRole('textbox', { name: 'Tìm trợ lý' })
  await search.fill('Bình')
  await expect(page.getByRole('heading', { name: 'Bình Minh' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Mây' })).toBeHidden()

  await search.fill('')
  await page.getByRole('button', { name: 'Tạo trợ lý' }).click()
  const dialog = page.getByRole('dialog', { name: 'Tạo trợ lý' })
  await dialog.getByRole('button', { name: 'Tạo trợ lý' }).click()
  await expect(dialog.getByText('Tên cần ít nhất 2 ký tự.')).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Tên trợ lý' }).fill('Bông')
  await dialog.getByRole('button', { name: 'Tạo trợ lý' }).click()
  await expect(page.getByRole('heading', { name: 'Bông' })).toBeVisible()

  await page.getByRole('button', { name: 'Đặt lại dữ liệu mẫu' }).click()
  await expect(page.getByRole('heading', { name: 'Bông' })).toBeHidden()
})

test('custom voice select và lưu revision', async ({ page }) => {
  await page.goto(`/assistants/${assistantId}/config/role`)
  const voice = page.getByRole('combobox', { name: 'Giọng nói' })
  await voice.click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.getByRole('option', { name: /Minh Châu/ }).click()
  await expect(voice).toContainText('Minh Châu')

  const prompt = page.getByRole('textbox', { name: 'Chỉ dẫn cho trợ lý' })
  await prompt.fill('Bạn là Mây, trợ lý tiếng Việt thân thiện và trả lời rõ ràng theo ngữ cảnh.')
  await page.getByRole('button', { name: 'Lưu bản nháp' }).click()
  await expect(page.getByText('Revision mới là #8.').first()).toBeVisible()
  await expect(page.getByText('Bản nháp #8')).toBeVisible()
})

test('pair device kiểm tra lỗi rồi hoàn thành', async ({ page }) => {
  await page.goto(`/assistants/${assistantId}/devices`)
  await page.getByRole('button', { name: 'Ghép nối thiết bị' }).click()
  const dialog = page.getByRole('dialog', { name: 'Ghép nối thiết bị' })
  await dialog.getByRole('button', { name: 'Ghép nối' }).click()
  const code = dialog.getByRole('textbox', { name: 'Mã xác thực' })
  await expect(code).toBeFocused()
  await expect(dialog.getByText('Mã xác thực cần ít nhất 6 ký tự.')).toBeVisible()
  await code.fill('VT-2608')
  await dialog.getByRole('textbox', { name: 'Tên hiển thị' }).fill('Veetee bàn làm việc')
  await dialog.getByRole('button', { name: 'Ghép nối' }).click()
  await expect(page.getByRole('heading', { name: 'Veetee bàn làm việc' })).toBeVisible()
  await expect(page.getByText('3 thiết bị').first()).toBeVisible()
})

test('history surface hiển thị retention notice và empty state', async ({ page }) => {
  await page.goto(`/assistants/${assistantId}/history`)
  await expect(page.getByText('Retention đang áp dụng')).toBeVisible()
  await expect(page.getByText('30 ngày transcript')).toBeVisible()
  await expect(page.getByText('Chưa có hội thoại', { exact: true })).toBeVisible()
})

test('history item mở được bằng keyboard Enter và Space', async ({ page }) => {
  await page.goto(`/assistants/${assistantId}/history`)
  const scenario = page.getByRole('combobox', { name: 'Tình huống mô phỏng' })
  await scenario.click()
  await page.getByRole('option', { name: /Có lịch sử/ }).click()
  const item = page.getByRole('button').filter({ hasText: 'TTFA' }).first()
  await item.focus()
  await expect(item).toBeFocused()
  await item.press('Enter')
  await expect(page.getByText('Chi tiết lượt nói')).toBeVisible()
  await item.press('Space')
  await expect(item).toHaveAttribute('aria-pressed', 'true')
})

test('history export tải JSON allow-list cho conversation đang chọn', async ({ page }) => {
  await page.goto(`/assistants/${assistantId}/history`)
  const scenario = page.getByRole('combobox', { name: 'Tình huống mô phỏng' })
  await scenario.click()
  await page.getByRole('option', { name: /Có lịch sử/ }).click()
  await page.getByRole('button').filter({ hasText: 'TTFA' }).first().click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Tải JSON' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^veetee-conversation-.*\.json$/)
})

test('history delete yêu cầu xác nhận và trả về empty state sau job hoàn tất', async ({ page }) => {
  await page.goto(`/assistants/${assistantId}/history`)
  const scenario = page.getByRole('combobox', { name: 'Tình huống mô phỏng' })
  await scenario.click()
  await page.getByRole('option', { name: /Có lịch sử/ }).click()
  await page.getByRole('button').filter({ hasText: 'TTFA' }).first().click()
  await page.getByRole('button', { name: 'Xóa', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Xóa conversation' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(/không thể hoàn tác/i)).toBeVisible()
  await dialog.getByRole('button', { name: 'Xóa conversation', exact: true }).click()
  await expect(page.getByText('Chưa có hội thoại', { exact: true })).toBeVisible()
})

test('provider unavailable không fallback và conflict giữ draft', async ({ page }) => {
  await page.goto(`/assistants/${assistantId}/config/model-memory`)
  const scenario = page.getByRole('combobox', { name: 'Tình huống mô phỏng' })
  await scenario.click()
  await page.getByRole('option', { name: /Provider không khả dụng/ }).click()
  await expect(page.getByText('Selection được giữ nguyên; không chuyển sang provider khác.')).toBeVisible()

  await scenario.click()
  await page.getByRole('option', { name: /Xung đột revision/ }).click()
  await page.getByRole('link', { name: 'Vai trò & giọng nói' }).click()
  const prompt = page.getByRole('textbox', { name: 'Chỉ dẫn cho trợ lý' })
  const localDraft = 'Draft local phải được giữ nguyên khi người dùng chọn hủy.'
  await prompt.fill(localDraft)
  await page.getByRole('button', { name: 'Lưu bản nháp' }).click()
  const dialog = page.getByRole('dialog', { name: 'Cấu hình đã thay đổi ở nơi khác' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Giữ draft' }).click()
  await expect(prompt).toHaveValue(localDraft)
})

test('provider registry sinh form từ schema và lưu revision', async ({ page }) => {
  await page.goto('/providers')
  await expect(page.getByRole('heading', { name: 'Các dịch vụ AI' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Địa chỉ dịch vụ' })).toHaveValue('https://api.groq.com/openai/v1')
  await expect(page.getByRole('spinbutton', { name: 'Độ dài trả lời tối đa' })).toHaveValue('512')
  await expect(page.getByRole('switch', { name: 'Cho phép gọi công cụ' })).toBeChecked()
  await expect(page.getByRole('textbox', { name: 'Cấu hình nâng cao' })).toHaveValue(/toolPolicy/)

  await page.getByRole('spinbutton', { name: 'Độ dài trả lời tối đa' }).fill('640')
  await page.getByRole('button', { name: 'Lưu cấu hình' }).click()
  await expect(page.getByText('Đã lưu cấu hình dịch vụ', { exact: true })).toBeVisible()
})

test('mobile không overflow và contextual navigation còn label', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/assistants/${assistantId}/config/role`)
  await expect(page.getByRole('link', { name: 'Mô hình & bộ nhớ' })).toBeVisible()
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(hasOverflow).toBe(false)
})

test('@a11y core surfaces không có serious hoặc critical violation', async ({ page }) => {
  for (const path of [
    '/assistants',
    `/assistants/${assistantId}/config/role`,
    `/assistants/${assistantId}/config/model-memory`,
    `/assistants/${assistantId}/devices`,
    `/assistants/${assistantId}/history`,
    '/providers',
    '/_preview/components',
  ]) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const result = await new AxeBuilder({ page }).analyze()
    const blocking = result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    expect(blocking, `${path}: ${blocking.map((item) => item.id).join(', ')}`).toEqual([])
  }
})
