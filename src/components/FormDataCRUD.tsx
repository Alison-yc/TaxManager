import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { FormDataRow, Json } from '../types/database'

type Props = {
  userEmail: string | null
  onSignOut: () => void
}

function previewContent(content: Json | null, max = 80): string {
  if (content == null) return '—'
  const s = JSON.stringify(content)
  return s.length > max ? `${s.slice(0, max)}…` : s
}

export function FormDataCRUD({ userEmail, onSignOut }: Props) {
  const [rows, setRows] = useState<FormDataRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editor, setEditor] = useState<{
    mode: 'create' | 'edit'
    id?: string
    jsonText: string
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: qErr } = await supabase
      .from('form_data')
      .select('*')
      .order('created_at', { ascending: false })
    if (qErr) {
      setError(qErr.message)
      setRows([])
    } else {
      setRows((data ?? []) as FormDataRow[])
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(id)
  }, [load])

  function openCreate() {
    setEditor({ mode: 'create', jsonText: '{\n  \n}' })
  }

  function openEdit(row: FormDataRow) {
    setEditor({
      mode: 'edit',
      id: row.id,
      jsonText: row.content == null ? '{}' : JSON.stringify(row.content, null, 2),
    })
  }

  function closeEditor() {
    if (!saving) setEditor(null)
  }

  async function saveEditor() {
    if (!editor) return
    let parsed: Json
    try {
      parsed = JSON.parse(editor.jsonText) as Json
    } catch {
      setError('content 需为合法 JSON')
      return
    }
    setSaving(true)
    setError(null)
    if (editor.mode === 'create') {
      // 仅写入 content；若库中 user_id 需自动填，可在 Supabase 用默认值/触发器
      const { error: insErr } = await supabase
        .from('form_data')
        .insert({ content: parsed })
      setSaving(false)
      if (insErr) {
        setError(insErr.message)
        return
      }
    } else if (editor.id) {
      const { error: updErr } = await supabase
        .from('form_data')
        .update({ content: parsed })
        .eq('id', editor.id)
      setSaving(false)
      if (updErr) {
        setError(updErr.message)
        return
      }
    }
    setEditor(null)
    setLoading(true)
    await load()
  }

  async function removeRow(id: string) {
    if (!confirm('确定删除这条记录？')) return
    setDeleting(id)
    setError(null)
    const { error: delErr } = await supabase.from('form_data').delete().eq('id', id)
    setDeleting(null)
    if (delErr) {
      setError(delErr.message)
      return
    }
    setLoading(true)
    await load()
  }

  return (
    <div className="shell">
      <header className="header">
        <div>
          <h1 className="title">表单数据</h1>
          {userEmail && <p className="muted">{userEmail}</p>}
        </div>
        <div className="header-actions">
          <button className="btn" type="button" onClick={() => void load()}>
            刷新
          </button>
          <button className="btn primary" type="button" onClick={openCreate}>
            新增
          </button>
          <button className="btn ghost" type="button" onClick={onSignOut}>
            退出
          </button>
        </div>
      </header>

      {error && <p className="err banner">{error}</p>}

      {loading ? (
        <p className="muted">加载中…</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>创建时间</th>
                <th>内容（预览）</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    暂无数据，可点击「新增」
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="nowrap">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="preview" title={JSON.stringify(row.content)}>
                    {previewContent(row.content as Json | null)}
                  </td>
                  <td className="col-actions">
                    <button
                      type="button"
                      className="btn sm"
                      onClick={() => openEdit(row)}
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      className="btn sm danger"
                      disabled={deleting === row.id}
                      onClick={() => void removeRow(row.id)}
                    >
                      {deleting === row.id ? '…' : '删除'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editor && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={editor.mode === 'create' ? '新增' : '编辑'}
        >
          <div className="modal">
            <h2 className="modal-title">
              {editor.mode === 'create' ? '新增记录' : '编辑 content（JSON）'}
            </h2>
            <textarea
              className="textarea"
              value={editor.jsonText}
              onChange={(e) => setEditor({ ...editor, jsonText: e.target.value })}
              spellCheck={false}
            />
            <div className="modal-actions">
              <button
                className="btn"
                type="button"
                onClick={closeEditor}
                disabled={saving}
              >
                取消
              </button>
              <button
                className="btn primary"
                type="button"
                onClick={() => void saveEditor()}
                disabled={saving}
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
