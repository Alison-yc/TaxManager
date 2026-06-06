import { supabase } from './supabase'

export const IMPORTED_DOCS_BUCKET = 'imported-docs'

export type StorageCategory = 'invoices' | 'declarations' | 'financial' | 'tax-proofs'

export async function getCurrentUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser()
  if (error) throw new Error(error.message)
  const id = data.user?.id
  if (!id) throw new Error('未登录，无法上传文件')
  return id
}

export function buildStoragePath(
  category: StorageCategory,
  userId: string,
  fileName: string,
): string {
  const safe = fileName.replace(/[/\\?%*:|"<>]/g, '-')
  return `${category}/${userId}/${safe}`
}

export async function uploadPdfFile(
  category: StorageCategory,
  file: File,
  targetFileName?: string,
): Promise<{ storagePath: string; userId: string }> {
  const userId = await getCurrentUserId()
  const storagePath = buildStoragePath(category, userId, targetFileName ?? file.name)
  const { error } = await supabase.storage.from(IMPORTED_DOCS_BUCKET).upload(storagePath, file, {
    upsert: true,
    contentType: 'application/pdf',
  })
  if (error) throw new Error(`PDF 上传失败：${error.message}`)
  return { storagePath, userId }
}

export async function createSignedPdfUrl(storagePath: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from(IMPORTED_DOCS_BUCKET)
    .createSignedUrl(storagePath, expiresIn)
  if (error) throw new Error(`PDF 预览链接生成失败：${error.message}`)
  if (!data?.signedUrl) throw new Error('PDF 预览链接为空')
  return data.signedUrl
}

export async function downloadPdfBlob(storagePath: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(IMPORTED_DOCS_BUCKET).download(storagePath)
  if (error) throw new Error(`PDF 下载失败：${error.message}`)
  return data
}

export async function downloadPdfFile(storagePath: string, fileName: string): Promise<void> {
  const blob = await downloadPdfBlob(storagePath)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.replace(/[/\\?%*:|"<>]/g, '-')
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
