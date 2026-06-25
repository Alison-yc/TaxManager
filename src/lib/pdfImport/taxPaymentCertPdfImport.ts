import {
  clampMoneyForDb,
  extractPdfText,
  parseCnDateToIso,
  parseMoney,
} from './extractPdfText'
import { uploadPdfFile } from '../pdfStorage'
import { supabase } from '../supabase'

export type TaxPaymentCertLine = {
  original_voucher_no: string
  tax_type: string | null
  item_name: string | null
  tax_period_start: string | null
  tax_period_end: string | null
  payment_date: string | null
  actual_amount: number | null
}

export type ParsedTaxPaymentCertPdf = {
  certificate_no: string
  issue_date: string | null
  tax_authority: string | null
  taxpayer_tax_id: string | null
  taxpayer_name: string | null
  total_amount: number | null
  remark: string | null
  lines: TaxPaymentCertLine[]
}

function pick(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const m = text.match(pattern)
    if (m?.[1]) return m[1].trim()
  }
  return null
}

function parseIsoDate(text: string | null): string | null {
  if (!text) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  return parseCnDateToIso(text)
}

function sliceCertBody(normalized: string): string {
  const bodyStart = normalized.search(/实缴\s*[(（]\s*退\s*[)）]\s*金额/)
  return bodyStart >= 0 ? normalized.slice(bodyStart) : normalized
}

function parseCertLines(normalized: string, certificateNo: string): TaxPaymentCertLine[] {
  const body = sliceCertBody(normalized)
  const lineRe =
    /(\d{15,20})\s+([\u4e00-\u9fa5]+(?:税|附加|收入|所得|费|金))\s+(.+?)\s+(\d{4}-\d{2}-\d{2})\s*至\s*(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+([\d,.]+)/g

  const lines: TaxPaymentCertLine[] = []
  let match: RegExpExecArray | null
  while ((match = lineRe.exec(body)) !== null) {
    const voucher = match[1]
    if (voucher === certificateNo) continue
    lines.push({
      original_voucher_no: voucher,
      tax_type: match[2]?.trim() || null,
      item_name: match[3]?.replace(/\s+/g, '').trim() || null,
      tax_period_start: parseIsoDate(match[4]),
      tax_period_end: parseIsoDate(match[5]),
      payment_date: parseIsoDate(match[6]),
      actual_amount: clampMoneyForDb(parseMoney(match[7])),
    })
  }
  return lines
}

/** 从明细行提取去重后的税种（征收项目），一张完税证明可含多项 */
export function extractCollectionItemsFromLines(lines: TaxPaymentCertLine[]): string[] {
  const set = new Set<string>()
  for (const line of lines) {
    const taxType = line.tax_type?.trim()
    if (taxType) set.add(taxType)
  }
  return [...set]
}

function buildFallbackLine(
  normalized: string,
  certificateNo: string,
  totalAmount: number | null,
): TaxPaymentCertLine | null {
  const body = sliceCertBody(normalized)
  const fallbackRe =
    /(\d{15,20})\s+([\u4e00-\u9fa5]+(?:税|附加|收入|所得|费|金))\s+(.+?)\s+(\d{4}-\d{2}-\d{2})\s*至\s*(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})\s+([\d,.]+)/
  const match = body.match(fallbackRe)
  if (!match || match[1] === certificateNo) return null
  return {
    original_voucher_no: match[1],
    tax_type: match[2]?.trim() || null,
    item_name: match[3]?.replace(/\s+/g, '').trim() || null,
    tax_period_start: parseIsoDate(match[4]),
    tax_period_end: parseIsoDate(match[5]),
    payment_date: parseIsoDate(match[6]),
    actual_amount: clampMoneyForDb(parseMoney(match[7]) ?? totalAmount),
  }
}

export function parseTaxPaymentCertText(text: string): ParsedTaxPaymentCertPdf {
  const normalized = text.replace(/\s+/g, ' ')

  const certificate_no =
    pick(normalized, [/No[●·\s]*(\d{10,30})/, /完税证明[^\d]*(\d{10,30})/]) ?? ''

  const issueRaw = pick(normalized, [/填发日期[：:\s]*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/])
  const issue_date = issueRaw ? parseCnDateToIso(issueRaw) : null

  const tax_authority = pick(normalized, [
    /税务机关[：:\s]*(.+?)(?=纳税人识别号)/,
    /税务机关[：:\s]*([^填发]{4,80})/,
  ])

  const taxpayer_tax_id = pick(normalized, [/纳税人识别号\s*([0-9A-Z]{15,20})/])
  const taxpayer_name = pick(normalized, [/纳税人名称\s*([\u4e00-\u9fa5（）()·]{2,50})/])

  const total_amount = parseMoney(
    pick(normalized, [/金额合计[^¥]*¥\s*([\d,.]+)/, /（小写）[^¥]*¥\s*([\d,.]+)/]),
  )

  const remark = pick(normalized, [/备注[：:\s]*([^\n\r]{2,200})/])

  let lines = parseCertLines(normalized, certificate_no)
  if (lines.length === 0) {
    const fallback = buildFallbackLine(normalized, certificate_no, total_amount)
    if (fallback) lines = [fallback]
  }

  if (lines.length === 0) {
    throw new Error('未能从 PDF 中解析完税证明明细行，请确认文件为表格式税收完税证明')
  }

  if (!certificate_no) {
    throw new Error('未能识别完税证明号码')
  }

  return {
    certificate_no,
    issue_date,
    tax_authority,
    taxpayer_tax_id,
    taxpayer_name,
    total_amount,
    remark,
    lines,
  }
}

export async function parseTaxPaymentCertPdf(file: File): Promise<ParsedTaxPaymentCertPdf> {
  const text = await extractPdfText(file)
  if (!/完税证明|税收完税证明|No[●·\s]*\d{10,}/.test(text)) {
    throw new Error('文件内容不像税收完税证明 PDF')
  }
  return parseTaxPaymentCertText(text)
}

export async function uploadTaxPaymentCertPdfFile(
  file: File,
): Promise<{ ok: true; importId: string } | { ok: false; message: string }> {
  const lower = file.name.toLowerCase()
  if (!lower.endsWith('.pdf')) {
    return { ok: false, message: '请选择 PDF 文件' }
  }

  try {
    const parsed = await parseTaxPaymentCertPdf(file)

    const { data: existingRows, error: dupErr } = await supabase
      .from('tax_payment_certificate_records')
      .select('import_id')
      .eq('certificate_no', parsed.certificate_no)
      .limit(1)
    if (dupErr) return { ok: false, message: dupErr.message }
    if (existingRows && existingRows.length > 0) {
      return { ok: false, message: `完税证明 ${parsed.certificate_no} 已导入，请勿重复上传` }
    }

    const { storagePath } = await uploadPdfFile(
      'tax-proofs',
      file,
      `${parsed.certificate_no}.pdf`,
    )

    const firstLine = parsed.lines[0]
    const importId = crypto.randomUUID()
    const actualAmount = clampMoneyForDb(parsed.total_amount ?? firstLine.actual_amount)
    const collectionItems = extractCollectionItemsFromLines(parsed.lines)

    const row = {
      import_id: importId,
      line_index: 0,
      certificate_no: parsed.certificate_no,
      original_voucher_no: firstLine.original_voucher_no,
      tax_type: firstLine.tax_type,
      item_name: firstLine.item_name,
      tax_period_start: firstLine.tax_period_start,
      tax_period_end: firstLine.tax_period_end,
      payment_date: firstLine.payment_date,
      actual_amount: actualAmount,
      taxpayer_name: parsed.taxpayer_name,
      taxpayer_tax_id: parsed.taxpayer_tax_id,
      issue_date: parsed.issue_date,
      tax_authority: parsed.tax_authority,
      total_amount: actualAmount,
      remark: parsed.remark,
      source_file_name: file.name,
      storage_path: storagePath,
      collection_items: collectionItems,
      content: { lines: parsed.lines, total_amount: parsed.total_amount },
    }

    const { data, error } = await supabase
      .from('tax_payment_certificate_records')
      .insert(row)
      .select('id')
      .single()
    if (error) {
      if (error.message.includes('idx_tax_payment_cert_user_certificate_no')) {
        return {
          ok: false,
          message: `完税证明 ${parsed.certificate_no} 已导入，请勿重复上传`,
        }
      }
      return { ok: false, message: error.message }
    }
    return { ok: true, importId: data.id as string }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
