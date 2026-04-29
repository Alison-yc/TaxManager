import { useCallback, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { MegaCell, MegaSection } from '../data/portalMegaMenuContent'
import {
  QUERY_PANELS,
  QUERY_TAB_LABELS,
  TAX_PANELS,
  TAX_TAB_LABELS,
} from '../data/portalMegaMenuContent'

type OpenKey = null | 'tax' | 'query'

const HOVER_LEAVE_MS = 180

function cellLabel(cell: MegaCell): string {
  if (typeof cell === 'string') return cell
  return cell.label
}

/** 在当前侧栏 Tab 下按关键词筛选右侧链接（不区分英文字母大小写） */
function filterMegaSections(sections: MegaSection[], raw: string): MegaSection[] {
  const needle = raw.trim().toLowerCase()
  if (!needle) return sections

  const out: MegaSection[] = []
  for (const sec of sections) {
    const cols: [MegaCell[], MegaCell[], MegaCell[]] = [[], [], []]
    for (let ci = 0; ci < 3; ci++) {
      cols[ci] = sec.cols[ci].filter((c) =>
        cellLabel(c).toLowerCase().includes(needle),
      )
    }
    if (cols[0].length > 0 || cols[1].length > 0 || cols[2].length > 0) {
      out.push({ title: sec.title, cols })
    }
  }
  return out
}

function FakeLink({ children }: { children: string }) {
  return (
    <button type="button" className="etax-mm-fake-link">
      {children}
    </button>
  )
}

function megaCellStableKey(secTitle: string, ci: number, ri: number, cell: MegaCell): string {
  if (typeof cell === 'string') {
    return `${secTitle}-${ci}-${ri}-${cell}`
  }
  return `${secTitle}-${ci}-${ri}-route-${cell.to}`
}

function MegaCellView({
  cell,
  onDismissMenu,
}: {
  cell: MegaCell
  onDismissMenu: () => void
}) {
  if (typeof cell === 'string') {
    return <FakeLink>{cell}</FakeLink>
  }
  return (
    <Link
      to={cell.to}
      className="etax-mm-fake-link etax-mm-fake-link--route"
      onClick={onDismissMenu}
    >
      {cell.label}
    </Link>
  )
}

function MegaSections({
  sections,
  onRouteNavigate,
  emptyHint,
}: {
  sections: MegaSection[]
  onRouteNavigate: () => void
  emptyHint: string
}) {
  if (sections.length === 0) {
    return <p className="etax-mm-search-empty">{emptyHint}</p>
  }

  return (
    <>
      {sections.map((sec) => (
        <div key={sec.title} className="etax-mm-block">
          <h3 className="etax-mm-heading">{sec.title}</h3>
          <div className="etax-mm-cols">
            {sec.cols.map((col, ci) => (
              <div key={ci} className="etax-mm-col">
                {col.map((cell, ri) => (
                  <MegaCellView
                    key={megaCellStableKey(sec.title, ci, ri, cell)}
                    cell={cell}
                    onDismissMenu={onRouteNavigate}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

export function PortalNavMegaMenus() {
  const [open, setOpen] = useState<OpenKey>(null)
  const [taxTab, setTaxTab] = useState(0)
  const [queryTab, setQueryTab] = useState(3)
  const [taxSearchQ, setTaxSearchQ] = useState('')
  const [querySearchQ, setQuerySearchQ] = useState('')
  const taxInputRef = useRef<HTMLInputElement>(null)
  const queryInputRef = useRef<HTMLInputElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const finalizeCloseMega = useCallback(() => {
    setOpen(null)
    setTaxSearchQ('')
    setQuerySearchQ('')
  }, [])

  const clearClose = useCallback(() => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const scheduleClose = useCallback(() => {
    clearClose()
    closeTimer.current = setTimeout(finalizeCloseMega, HOVER_LEAVE_MS)
  }, [clearClose, finalizeCloseMega])

  const hoverKey = useCallback((key: 'tax' | 'query') => {
    clearClose()
    setOpen(key)
  }, [clearClose])

  const closePanel = useCallback(() => {
    clearClose()
    finalizeCloseMega()
  }, [clearClose, finalizeCloseMega])

  const baseQuerySections = useMemo(() => QUERY_PANELS[queryTab] ?? [], [queryTab])
  const baseTaxSections = useMemo(() => TAX_PANELS[taxTab] ?? [], [taxTab])

  const filteredQuerySections = useMemo(
    () => filterMegaSections(baseQuerySections, querySearchQ),
    [baseQuerySections, querySearchQ],
  )
  const filteredTaxSections = useMemo(
    () => filterMegaSections(baseTaxSections, taxSearchQ),
    [baseTaxSections, taxSearchQ],
  )

  return (
    <>
      <div
        className="etax-nav-dd"
        onMouseEnter={() => hoverKey('tax')}
        onMouseLeave={scheduleClose}
      >
        <span className="etax-portal-nav-item etax-nav-dd-trigger">我要办税</span>
        {open === 'tax' ? (
          <div
            className="etax-portal-mm etax-portal-mm--tax"
            role="region"
            aria-label="我要办税菜单"
            onMouseEnter={clearClose}
            onMouseLeave={scheduleClose}
          >
            <button
              type="button"
              className="etax-mm-close"
              aria-label="关闭"
              onClick={closePanel}
            />
            <div className="etax-mm-inner">
              <aside className="etax-mm-side" aria-label="办税分类">
                <div className="etax-mm-side-title">我要办税</div>
                <div className="etax-mm-tabs" role="tablist" aria-label="办税分类切换">
                  {TAX_TAB_LABELS.map((label, i) => (
                    <button
                      key={label}
                      type="button"
                      role="tab"
                      id={`etax-tax-tab-${i}`}
                      aria-selected={taxTab === i}
                      className={`etax-mm-tab${taxTab === i ? ' active' : ''}`}
                      onClick={() => setTaxTab(i)}
                      onMouseEnter={clearClose}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </aside>
              <div className="etax-mm-body">
                <div
                  className="etax-mm-searchbar"
                  role="search"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <input
                    ref={taxInputRef}
                    type="search"
                    placeholder="请输入关键词筛选"
                    value={taxSearchQ}
                    onChange={(e) => setTaxSearchQ(e.target.value)}
                    aria-label="在当前分类中检索功能名称"
                    className="etax-mm-search-input"
                    enterKeyHint="search"
                  />
                  <button
                    type="button"
                    className="etax-mm-search-btn"
                    aria-label="聚焦搜索框（当前检索已即时生效）"
                    onClick={() => taxInputRef.current?.focus()}
                  />
                </div>
                <MegaSections
                  sections={filteredTaxSections}
                  onRouteNavigate={closePanel}
                  emptyHint={
                    taxSearchQ.trim()
                      ? `未找到与「${taxSearchQ.trim()}」匹配的功能名称，请尝试其它关键词。`
                      : '暂无内容。'
                  }
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div
        className="etax-nav-dd"
        onMouseEnter={() => hoverKey('query')}
        onMouseLeave={scheduleClose}
      >
        <span className="etax-portal-nav-item etax-nav-dd-trigger">我要查询</span>
        {open === 'query' ? (
          <div
            className="etax-portal-mm etax-portal-mm--query"
            role="region"
            aria-label="我要查询菜单"
            onMouseEnter={clearClose}
            onMouseLeave={scheduleClose}
          >
            <button
              type="button"
              className="etax-mm-close"
              aria-label="关闭"
              onClick={closePanel}
            />
            <div className="etax-mm-inner">
              <aside className="etax-mm-side" aria-label="查询分类">
                <div className="etax-mm-side-title">我要查询</div>
                <div className="etax-mm-tabs" role="tablist" aria-label="查询分类切换">
                  {QUERY_TAB_LABELS.map((label, i) => (
                    <button
                      key={label}
                      type="button"
                      role="tab"
                      id={`etax-query-tab-${i}`}
                      aria-selected={queryTab === i}
                      className={`etax-mm-tab${queryTab === i ? ' active' : ''}`}
                      onClick={() => setQueryTab(i)}
                      onMouseEnter={clearClose}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </aside>
              <div className="etax-mm-body">
                <div
                  className="etax-mm-searchbar"
                  role="search"
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <input
                    ref={queryInputRef}
                    type="search"
                    placeholder="请输入关键词筛选"
                    value={querySearchQ}
                    onChange={(e) => setQuerySearchQ(e.target.value)}
                    aria-label="在当前分类中检索功能名称"
                    className="etax-mm-search-input"
                    enterKeyHint="search"
                  />
                  <button
                    type="button"
                    className="etax-mm-search-btn"
                    aria-label="聚焦搜索框（当前检索已即时生效）"
                    onClick={() => queryInputRef.current?.focus()}
                  />
                </div>
                <MegaSections
                  sections={filteredQuerySections}
                  onRouteNavigate={closePanel}
                  emptyHint={
                    querySearchQ.trim()
                      ? `未找到与「${querySearchQ.trim()}」匹配的功能名称，请尝试其它关键词。`
                      : '暂无内容。'
                  }
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
