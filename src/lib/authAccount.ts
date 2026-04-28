/**
 * Supabase 只有 email/password 登录接口，没有单独的「用户名」字段。
 *
 * 体验上像账号登录：用户只输入邮箱「本地部分」时，在前面自动拼 `@后缀`；
 * Supabase Dashboard 里的用户邮箱需与映射结果一致（例如 `123456@qq.com`）。
 *
 * 若用户输入里已含 `@`，则视为完整邮箱，原样发往服务端（可作备用）。
 */

/** 后缀里不要自带 @（如填 qq.com、company.com）；若写成 @qq.com 会自动去掉前缀 @ */
function loginEmailSuffix(): string {
  const raw = (import.meta.env.VITE_AUTH_EMAIL_SUFFIX as string | undefined)?.trim()
  const s = raw ? raw.replace(/^@/, '') : ''
  return s || 'qq.com'
}

/**
 * @param loginInput - 可为「前缀」或「完整邮箱」
 */
export function loginAccountToAuthEmail(loginInput: string): string {
  const raw = loginInput.trim()
  if (!raw) throw new Error('请输入账号或邮箱')

  if (raw.includes('@')) {
    return raw.toLowerCase()
  }

  const localPart = raw.toLowerCase()
  const suffix = loginEmailSuffix()
  return `${localPart}@${suffix}`
}
