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
  await expect(page.getByText('Bạn có thể áp dụng thay đổi này cho robot bất cứ lúc nào.').first()).toBeVisible()
  await expect(page.getByText('Đã lưu', { exact: true })).toBeVisible()
})

test('tạo personality tùy chỉnh và lưu chỉ dẫn riêng', async ({ page }) => {
  await page.goto(`/assistants/${assistantId}/config/role`)
  await page.getByRole('switch', { name: 'Tùy chỉnh' }).click()
  await page.getByRole('textbox', { name: 'Tên tính cách' }).fill('Người hướng dẫn kiên nhẫn')
  await page.getByRole('textbox', { name: 'Chỉ dẫn tính cách' }).fill('Giải thích từng bước và hỏi lại khi yêu cầu chưa đủ dữ kiện.')
  await page.getByRole('button', { name: 'Lưu bản nháp' }).click()
  await expect(page.getByText('Bạn có thể áp dụng thay đổi này cho robot bất cứ lúc nào.').first()).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Tùy chỉnh' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('textbox', { name: 'Tên tính cách' })).toHaveValue('Người hướng dẫn kiên nhẫn')
})

test('pair device kiểm tra lỗi rồi hoàn thành', async ({ page }) => {
  await page.goto(`/assistants/${assistantId}/devices`)
  await page.getByRole('button', { name: 'Ghép nối thiết bị' }).click()
  const dialog = page.getByRole('dialog', { name: 'Ghép nối thiết bị' })
  await dialog.getByRole('button', { name: 'Ghép nối' }).click()
  const code = dialog.getByRole('textbox', { name: 'Mã xác thực' })
  await expect(code).toBeFocused()
  await expect(dialog.getByText('Nhập đúng 6 chữ số trên robot.')).toBeVisible()
  await code.fill('260812')
  await dialog.getByRole('textbox', { name: 'Tên hiển thị' }).fill('Veetee bàn làm việc')
  await dialog.getByRole('button', { name: 'Ghép nối' }).click()
  await expect(page.getByRole('heading', { name: 'Veetee bàn làm việc' })).toBeVisible()
  await expect(page.getByText('3 thiết bị').first()).toBeVisible()
})

test('history surface hiển thị retention notice và empty state', async ({ page }) => {
  await page.goto(`/assistants/${assistantId}/history`)
  await expect(page.getByText('Đang áp dụng', { exact: true })).toBeVisible()
  await expect(page.getByText('30 ngày nội dung')).toBeVisible()
  await expect(page.getByText('Chưa có hội thoại', { exact: true })).toBeVisible()
})

test('history item mở được bằng keyboard Enter và Space', async ({ page }) => {
  await page.goto(`/assistants/${assistantId}/history`)
  const scenario = page.getByRole('combobox', { name: 'Tình huống mô phỏng' })
  await scenario.click()
  await page.getByRole('option', { name: /Có lịch sử/ }).click()
  const item = page.getByRole('button').filter({ hasText: 'Phản hồi đầu tiên' }).first()
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
  await page.getByRole('button').filter({ hasText: 'Phản hồi đầu tiên' }).first().click()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Tải nội dung' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^veetee-conversation-.*\.json$/)
})

test('history delete yêu cầu xác nhận và trả về empty state sau job hoàn tất', async ({ page }) => {
  await page.goto(`/assistants/${assistantId}/history`)
  const scenario = page.getByRole('combobox', { name: 'Tình huống mô phỏng' })
  await scenario.click()
  await page.getByRole('option', { name: /Có lịch sử/ }).click()
  await page.getByRole('button').filter({ hasText: 'Phản hồi đầu tiên' }).first().click()
  await page.getByRole('button', { name: 'Xóa', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Xóa cuộc trò chuyện' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(/không thể hoàn tác/i)).toBeVisible()
  await dialog.getByRole('button', { name: 'Xóa cuộc trò chuyện', exact: true }).click()
  await expect(page.getByText('Chưa có hội thoại', { exact: true })).toBeVisible()
})

test('provider unavailable không fallback và conflict giữ draft', async ({ page }) => {
  await page.goto(`/assistants/${assistantId}/config/model-memory`)
  const scenario = page.getByRole('combobox', { name: 'Tình huống mô phỏng' })
  await scenario.click()
  await page.getByRole('option', { name: /Dịch vụ tạm thời không khả dụng/ }).click()
  await expect(page.getByText('Lựa chọn hiện tại được giữ nguyên; không tự chuyển sang dịch vụ khác.')).toBeVisible()

  await scenario.click()
  await page.getByRole('option', { name: /Cấu hình thay đổi ở nơi khác/ }).click()
  await page.getByRole('link', { name: 'Vai trò & giọng nói' }).click()
  const prompt = page.getByRole('textbox', { name: 'Chỉ dẫn cho trợ lý' })
  const localDraft = 'Draft local phải được giữ nguyên khi người dùng chọn hủy.'
  await prompt.fill(localDraft)
  await page.getByRole('button', { name: 'Lưu bản nháp' }).click()
  const dialog = page.getByRole('dialog', { name: 'Cấu hình đã thay đổi ở nơi khác' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Giữ lại thay đổi' }).click()
  await expect(prompt).toHaveValue(localDraft)
})

test('provider registry sinh form từ schema và lưu revision', async ({ page }) => {
  await page.goto('/providers/llm')
  await expect(page.getByRole('heading', { name: 'Bộ não trả lời' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Base URL' })).toHaveValue('https://api.groq.com/openai/v1')
  await expect(page.getByRole('spinbutton', { name: 'Độ dài trả lời tối đa' })).toHaveValue('512')
  await expect(page.getByRole('switch', { name: 'Cho phép gọi công cụ' })).toBeChecked()
  await expect(page.getByRole('textbox', { name: 'Cấu hình nâng cao' })).toHaveValue(/toolPolicy/)

  await page.getByRole('spinbutton', { name: 'Độ dài trả lời tối đa' }).fill('640')
  await page.getByRole('button', { name: 'Lưu cấu hình' }).click()
  await expect(page.getByText('Đã lưu cấu hình dịch vụ', { exact: true })).toBeVisible()
})

test('khóa kết nối giữ nguyên chiều rộng ở mọi viewport', async ({ page }) => {
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 800, height: 900 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport)
    await page.goto('/providers/llm')
    const metrics = await page.locator('.provider-layout').evaluate((layout) => {
      const panel = layout.querySelector<HTMLElement>(':scope > .secret-card')
      const create = panel?.querySelector<HTMLElement>('.secret-create')
      if (!panel || !create) throw new Error('Khong tim thay panel khoa ket noi')
      const layoutRect = layout.getBoundingClientRect()
      const panelRect = panel.getBoundingClientRect()
      const createRect = create.getBoundingClientRect()
      const nameInput = panel.querySelector<HTMLElement>('#secret-reference-name')
      const valueInput = panel.querySelector<HTMLElement>('#secret-reference-value')
      if (!nameInput || !valueInput) throw new Error('Khong tim thay o nhap khoa ket noi')
      return {
        bodyScrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
        panelGridColumn: getComputedStyle(panel).gridColumn,
        layoutWidth: layoutRect.width,
        panelWidth: panelRect.width,
        panelRight: panelRect.right,
        createRight: createRect.right,
        nameInputTop: nameInput.getBoundingClientRect().top,
        valueInputTop: valueInput.getBoundingClientRect().top,
      }
    })

    expect(metrics.panelGridColumn).toBe('1 / -1')
    expect(metrics.panelWidth).toBeGreaterThanOrEqual(metrics.layoutWidth - 1)
    expect(metrics.createRight).toBeLessThanOrEqual(metrics.panelRight + 1)
    expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth)
    if (viewport.width > 700) {
      expect(Math.abs(metrics.nameInputTop - metrics.valueInputTop)).toBeLessThanOrEqual(1)
    }
  }
})

test('mobile không overflow và contextual navigation còn label', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/assistants/${assistantId}/config/role`)
  await expect(page.getByRole('link', { name: 'Mô hình & bộ nhớ' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Lịch sử hội thoại' })).toBeVisible()
  const navigationMetrics = await page.locator('.workspace-navigation').evaluate((navigation) => ({
    clientWidth: navigation.clientWidth,
    scrollWidth: navigation.scrollWidth,
  }))
  expect(navigationMetrics.scrollWidth).toBeLessThanOrEqual(navigationMetrics.clientWidth)
  const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(hasOverflow).toBe(false)
})

test('mobile menu có Dịch vụ AI và điều hướng đúng màn hình', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/assistants')
  await page.getByRole('button', { name: 'Mở điều hướng' }).click()
  await expect(page.getByRole('menuitem', { name: 'Dịch vụ AI' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Dịch vụ AI' }).click()
  await expect(page).toHaveURL(/\/model-config$/)
  await expect(page.getByRole('heading', { name: 'Cấu hình model' })).toBeVisible()
})

test('role nâng cao thu gọn mặc định và cảnh báo bản nháp khi rời trang', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`/assistants/${assistantId}/config/role`)

  const limits = page.getByRole('button', { name: /Giới hạn sử dụng/ })
  await expect(limits).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('spinbutton', { name: 'Lượt hội thoại đồng thời' })).toBeHidden()
  await limits.click()
  await expect(limits).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('spinbutton', { name: 'Lượt hội thoại đồng thời' })).toBeVisible()

  const prompt = page.getByRole('textbox', { name: 'Chỉ dẫn cho trợ lý' })
  const draft = 'Bản nháp chưa lưu cần được giữ lại.'
  await prompt.fill(draft)
  await page.getByRole('link', { name: 'Mô hình & bộ nhớ' }).click()
  const dialog = page.getByRole('dialog', { name: 'Bạn có thay đổi chưa lưu' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Ở lại' }).click()
  await expect(page).toHaveURL(new RegExp(`/assistants/${assistantId}/config/role$`))
  await expect(prompt).toHaveValue(draft)

  await page.getByRole('link', { name: 'Mô hình & bộ nhớ' }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Rời trang' }).click()
  await expect(page).toHaveURL(new RegExp(`/assistants/${assistantId}/config/model-memory$`))
})

test('provider CTA và badge không gây vỡ bố cục trên mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/providers/llm')
  const create = page.getByRole('button', { name: 'Tạo cấu hình' })
  await expect(create).toBeVisible()
  const metrics = await page.locator('.provider-list-toolbar').evaluate((toolbar) => {
    const button = toolbar.querySelector<HTMLElement>('.vt-button')
    const badge = document.querySelector<HTMLElement>('.list-heading .vt-badge')
    if (!button || !badge) throw new Error('Khong tim thay CTA hoac badge provider')
    return {
      buttonWidth: button.getBoundingClientRect().width,
      toolbarWidth: toolbar.getBoundingClientRect().width,
      badgeHeight: badge.getBoundingClientRect().height,
      badgeWhiteSpace: getComputedStyle(badge).whiteSpace,
      bodyScrollWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
    }
  })
  expect(metrics.buttonWidth).toBeGreaterThanOrEqual(metrics.toolbarWidth - 1)
  expect(metrics.badgeWhiteSpace).toBe('nowrap')
  expect(metrics.badgeHeight).toBeLessThanOrEqual(24)
  expect(metrics.bodyScrollWidth).toBeLessThanOrEqual(metrics.viewportWidth)
})

test('@a11y core surfaces không có serious hoặc critical violation', async ({ page }) => {
  for (const path of [
    '/assistants',
    `/assistants/${assistantId}/config/role`,
    `/assistants/${assistantId}/config/model-memory`,
    `/assistants/${assistantId}/devices`,
    `/assistants/${assistantId}/history`,
    '/providers',
    '/providers/llm',
    '/providers/tts/voices',
    '/_preview/components',
  ]) {
    await page.goto(path)
    await page.waitForLoadState('networkidle')
    const result = await new AxeBuilder({ page }).analyze()
    const blocking = result.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    expect(blocking, `${path}: ${blocking.map((item) => item.id).join(', ')}`).toEqual([])
  }
})
