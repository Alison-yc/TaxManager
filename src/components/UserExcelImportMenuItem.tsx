import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { uploadFormDataFromExcelFile } from '../lib/formDataExcelUpload'

/**
 * 顶栏用户下拉「账户中心」：选择 Excel 导入至 form_data，成功后跳转申报信息查询。
 */
export function UserExcelImportMenuItem() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function handleFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    setErr(null)
    setBusy(true)
    try {
      const r = await uploadFormDataFromExcelFile(file)
      if (!r.ok) {
        setErr(r.message)
        return
      }
      navigate('/query')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="etax-user-excel-slot">
      <button
        type="button"
        className={`etax-portal-user-menu-action${busy ? ' etax-portal-user-menu-action--busy' : ''}`}
        role="menuitem"
        disabled={busy}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => inputRef.current?.click()}
      >
        <span className="etax-portal-user-menu-action-ic" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 20v-1c0-3 3.5-5 7-5s7 2 7 5v1" />
          </svg>
        </span>
        <span>{busy ? '导入中…' : '账户中心'}</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        className="hidden-file-input"
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => void handleFile(e)}
      />
      {err ? (
        <p role="alert" className="etax-portal-user-menu-err">
          {err}
        </p>
      ) : null}
    </div>
  )
}
