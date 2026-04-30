import type { CSSProperties } from 'react'
import { useState } from 'react'
import { ETAX_PUBLIC } from '../constants/assetBase'

const homeAsset = `${ETAX_PUBLIC}home/`

const hotServiceItems = [
  { label: '新办纳税人开业', icon: 'service-new-taxpayer.png' },
  { label: '代开增值税发票', icon: 'service-invoice.png' },
  { label: '印花税申报', icon: 'service-stamp-tax.png' },
  { label: '车船税申报', icon: 'service-vehicle-tax.png' },
  { label: '开具税收完税证明', icon: 'service-tax-proof.png' },
  { label: '开具无欠税证明', icon: 'service-no-arrears.png' },
  { label: '跨境相关人员关联关系', icon: 'service-cross-border.png' },
]

const recommendLeft = [
  { t: '国家税务总局关于啤酒计征消费税有关问题的公告', d: '2026/4/1' },
  { t: '国家税务总局 工业和信息化部关于发布（免征车辆购置税的...', d: '2026/3/13' },
  { t: '国家税务总局关于调整增值税纳税申报有关事项的公告', d: '2026/2/1' },
  { t: '国家税务总局关于发布《出口业务增值税和消费税退（免）税...', d: '2026/1/30' },
  { t: '国家税务总局关于起征点标准等增值税征管事项的公告', d: '2026/1/30' },
]

const recommendRight = [
  { t: '国家税务总局关于土地增值税若干征管口径的公告', d: '2026/1/1' },
  { t: '国家税务总局关于增值税一般纳税人登记管理有关事项的公告', d: '2026/1/1' },
  { t: '国家税务总局关于废止《增值税一般纳税人登记管理办法》的决定', d: '2026/1/1' },
  { t: '国家税务总局 工业和信息化部关于发布（免征车辆购置税的没有...', d: '2025/12/26' },
  { t: '国家税务总局 最高人民法院关于企业破产程序中若干税费征管事...', d: '2025/11/27' },
]

const homeReminders = [
  { text: '出口应征税台账新增报关单提醒', date: '2026-04-25' },
  { text: '增值税专用发票即将逾期认证提醒', date: '2026-04-23' },
  { text: '残疾人就业保障金申报期临近提醒', date: '2026-04-22' },
  { text: '更正申报后需重新打开税款缴纳界面', date: '2026-04-18' },
]

type TodoTabId = 'declare' | 'doc' | 'risk' | 'other'

const todoTabs: { id: TodoTabId; label: string; badge?: number }[] = [
  { id: 'declare', label: '本期应申报', badge: 1 },
  { id: 'doc', label: '待签收文书' },
  { id: 'risk', label: '风险疑点' },
  { id: 'other', label: '其它' },
]

type TodoStatusTone = 'pending' | 'done' | 'neutral' | 'warn' | 'muted'

type TodoRow = {
  matter: string
  deadline: string
  status: string
  statusTone: TodoStatusTone
  actions: { label: string }[]
}

const todoRowsByTab: Record<TodoTabId, TodoRow[]> = {
  declare: [
    {
      matter: '居民企业（查账征收）企业所得税月（季）度预缴纳税申报',
      deadline: '2026-05-31',
      status: '未申报',
      statusTone: 'pending',
      actions: [{ label: '填写申报表' }],
    },
    {
      matter: '财务报表报送（年报）',
      deadline: '2026-05-31',
      status: '已申报',
      statusTone: 'done',
      actions: [{ label: '更正' }],
    },
    {
      matter: '居民企业（查账征收）企业所得税月（季）度预缴纳税申报',
      deadline: '2026-04-20',
      status: '已申报',
      statusTone: 'done',
      actions: [{ label: '更正' }, { label: '作废' }],
    },
    {
      matter: '通用申报（工会经费）',
      deadline: '2026-04-20',
      status: '已申报',
      statusTone: 'done',
      actions: [{ label: '更正' }, { label: '作废' }],
    },
    {
      matter: '财务报表报送（季报）',
      deadline: '2026-04-20',
      status: '已申报',
      statusTone: 'done',
      actions: [{ label: '更正' }],
    },
  ],
  doc: [
    {
      matter: '《税务事项通知书》（石高税通〔2026〕12号）',
      deadline: '2026-04-28',
      status: '待签收',
      statusTone: 'neutral',
      actions: [{ label: '签收' }],
    },
    {
      matter: '《责令限期改正通知书》',
      deadline: '2026-04-26',
      status: '待签收',
      statusTone: 'neutral',
      actions: [{ label: '查看' }, { label: '签收' }],
    },
    {
      matter: '《行政处罚事项告知书》送达回证',
      deadline: '2026-04-22',
      status: '已签收',
      statusTone: 'done',
      actions: [{ label: '下载' }],
    },
    {
      matter: '《纳税评估约谈通知书》',
      deadline: '2026-04-19',
      status: '待签收',
      statusTone: 'neutral',
      actions: [{ label: '签收' }],
    },
    {
      matter: '《风险提示函》',
      deadline: '2026-04-15',
      status: '已签收',
      statusTone: 'done',
      actions: [{ label: '查看' }],
    },
  ],
  risk: [
    {
      matter: '进项税额转出比例与行业均值偏离疑点提示',
      deadline: '2026-05-15',
      status: '待核实',
      statusTone: 'warn',
      actions: [{ label: '去处理' }],
    },
    {
      matter: '单月开票金额环比波动超阈值提醒',
      deadline: '2026-04-30',
      status: '待核实',
      statusTone: 'warn',
      actions: [{ label: '填说明' }],
    },
    {
      matter: '跨省迁出涉税事项衔接提醒',
      deadline: '2026-04-21',
      status: '处理中',
      statusTone: 'muted',
      actions: [{ label: '进度' }],
    },
    {
      matter: '关联交易同期资料报送期限提醒',
      deadline: '2026-04-18',
      status: '已反馈',
      statusTone: 'done',
      actions: [{ label: '查看' }],
    },
    {
      matter: '企业所得税税前扣除凭证存疑提示',
      deadline: '2026-04-10',
      status: '已反馈',
      statusTone: 'done',
      actions: [{ label: '详情' }],
    },
  ],
  other: [
    {
      matter: '增值税专用发票（中文三联无金额限制版）票种核定',
      deadline: '2026-04-29',
      status: '办理中',
      statusTone: 'muted',
      actions: [{ label: '进度查询' }],
    },
    {
      matter: '增值税留抵退税申请（制造业）',
      deadline: '2026-04-27',
      status: '审核中',
      statusTone: 'muted',
      actions: [{ label: '详情' }],
    },
    {
      matter: '办税人员实名信息变更',
      deadline: '2026-04-24',
      status: '补正中',
      statusTone: 'pending',
      actions: [{ label: '去补正' }],
    },
    {
      matter: '三方协议账号验证失败',
      deadline: '2026-04-20',
      status: '待处理',
      statusTone: 'neutral',
      actions: [{ label: '重签' }],
    },
    {
      matter: '历史申报表批量导出申请',
      deadline: '2026-04-12',
      status: '已完成',
      statusTone: 'done',
      actions: [{ label: '下载' }],
    },
  ],
}

function todoStatusClass(tone: TodoStatusTone): string {
  switch (tone) {
    case 'pending':
      return 'etx-ph-status-tag pending'
    case 'done':
      return 'etx-ph-status-tag done'
    case 'neutral':
      return 'etx-ph-status-tag neutral'
    case 'warn':
      return 'etx-ph-status-tag warn'
    case 'muted':
      return 'etx-ph-status-tag muted'
  }
}

/**
 * 首页：按河北电子税务局门户结构做装饰性 1:1 版式（无业务接口，可滚动）。
 */
export function HomePage() {
  const [favTab, setFavTab] = useState<'fav' | 'scene'>('fav')
  const [todoTab, setTodoTab] = useState<TodoTabId>('declare')
  const recommendBannerStyle = {
    '--etax-home-recommend-bg': `url(${ETAX_PUBLIC}home-recommend.optimized.jpg)`,
  } as CSSProperties

  return (
    <div className="etax-portal-home">
      <div className="etax-portal-home-inner">
        {/* 用户信息 + 待办 */}
        <section className="etax-ph-row etx-ph-top" aria-label="用户与待办">
          <div className="etx-ph-col">
            <div className="etx-ph-card etx-ph-usercard">
              <div className="etx-ph-user-line1">
                <span className="etx-ph-user-name">河北镁神科技股份有限公司</span>
                <span className="etx-ph-user-badge">
                  <span className="etx-ph-user-badge-ic" aria-hidden>
                    A
                  </span>
                  <span className="etx-ph-user-badge-text">级纳税人</span>
                </span>
              </div>
              <div className="etx-ph-user-line2">
                <span className="etx-ph-user-id">911305316610547945</span>
                <span className="etx-ph-user-period">本月征期已结束</span>
              </div>
            </div>
            <div className="etx-ph-card etx-ph-subcard">
              <div className="etx-ph-reminder-titlebar">
                <span>我的提醒</span>
                <button type="button" className="etx-ph-card-more fake" aria-label="更多">
                  &gt;
                </button>
              </div>
              <ul className="etx-ph-reminder-list">
                {homeReminders.map((item, index) => (
                  <li key={`reminder-${index}-${item.date}`} className="etx-ph-reminder-row">
                    <span className="etx-ph-reminder-ic" aria-hidden>
                      i
                    </span>
                    <span className="etx-ph-reminder-text">{item.text}</span>
                    <span className="etx-ph-reminder-date">{item.date}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="etx-ph-col etx-ph-col-wide">
            <div className="etx-ph-card etx-ph-todo">
              <div className="etx-ph-todo-head">
                <div className="etx-ph-todo-titlebar">
                  <span>我的待办</span>
                  <button type="button" className="etx-ph-card-more fake" aria-label="更多">
                    &gt;
                  </button>
                </div>
                <div className="etx-ph-todo-tabs" role="tablist" aria-label="待办分类">
                  {todoTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={todoTab === tab.id}
                      className={`etx-ph-todo-tab${todoTab === tab.id ? ' active' : ''}${
                        tab.badge != null ? ' has-badge' : ''
                      }`}
                      onClick={() => setTodoTab(tab.id)}
                    >
                      <span className="etx-ph-todo-tab-label">{tab.label}</span>
                      {tab.badge != null ? (
                        <span className="etx-ph-todo-tab-badge" aria-label={`${tab.badge} 条`}>
                          {tab.badge}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
              <div className="etx-ph-todo-panel">
                <div className="etx-ph-todo-colhead" role="row">
                  <span className="etx-ph-todo-th etx-ph-todo-th-matter" role="columnheader">
                    事项名称
                  </span>
                  <span className="etx-ph-todo-th etx-ph-todo-th-deadline" role="columnheader">
                    办理期限
                  </span>
                  <span className="etx-ph-todo-th etx-ph-todo-th-status" role="columnheader">
                    标签状态
                  </span>
                  <span className="etx-ph-todo-th etx-ph-todo-th-op" role="columnheader">
                    操作
                  </span>
                </div>
                <div className="etx-ph-todo-table">
                  {todoRowsByTab[todoTab].map((row, index) => (
                    <div
                      key={`${todoTab}-${index}-${row.deadline}`}
                      className="etx-ph-todo-row"
                      role="row"
                    >
                      <span className="etx-ph-todo-td etx-ph-todo-td-matter" role="cell" title={row.matter}>
                        {row.matter}
                      </span>
                      <span className="etx-ph-todo-td etx-ph-todo-td-deadline" role="cell">
                        {row.deadline}
                      </span>
                      <span className="etx-ph-todo-td etx-ph-todo-td-status" role="cell">
                        <span className={todoStatusClass(row.statusTone)}>{row.status}</span>
                      </span>
                      <span className="etx-ph-todo-td etx-ph-todo-td-op" role="cell">
                        {row.actions.map((a, i) => (
                          <span key={`${a.label}-${i}`}>
                            {i > 0 ? <span className="etx-ph-op-sep">|</span> : null}
                            <button type="button" className="etx-ph-op-link fake">
                              {a.label}
                            </button>
                          </span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 热门服务 */}
        <section className="etx-ph-card etx-ph-hot" aria-label="热门服务">
          <div className="etx-ph-card-head etx-ph-card-head-plain">
            <span>热门服务</span>
          </div>
          <div className="etx-ph-carousel">
            <button type="button" className="etx-ph-carousel-btn fake" aria-label="上一屏">
              ‹
            </button>
            <div className="etx-ph-carousel-track">
              {hotServiceItems.map((item) => (
                <div key={item.label} className="etx-ph-hot-item">
                  <img className="etx-ph-hot-icon" src={`${homeAsset}${item.icon}`} alt="" aria-hidden />
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
            <button type="button" className="etx-ph-carousel-btn fake" aria-label="下一屏">
              ›
            </button>
          </div>
        </section>

        {/* 我的收藏 | 场景办税 */}
        <section className="etx-ph-card etx-ph-fav" aria-label="收藏与场景办税">
          <div className="etx-ph-fav-tabs">
            <button
              type="button"
              className={`etx-ph-fav-tab${favTab === 'fav' ? ' active' : ''}`}
              onClick={() => setFavTab('fav')}
            >
              我的收藏
            </button>
            <span className="etx-ph-fav-sep" aria-hidden>
              |
            </span>
            <button
              type="button"
              className={`etx-ph-fav-tab${favTab === 'scene' ? ' active' : ''}`}
              onClick={() => setFavTab('scene')}
            >
              场景办税
            </button>
          </div>
          <div className="etx-ph-fav-body">
            <button type="button" className="etx-ph-fav-arrow etx-ph-fav-arrow-left fake" aria-label="上一屏">
              ‹
            </button>
            <button type="button" className="etx-ph-add-fav fake">
              <span className="etx-ph-add-plus" aria-hidden />
              <span>添加收藏</span>
            </button>
            <button type="button" className="etx-ph-fav-arrow etx-ph-fav-arrow-right fake" aria-label="下一屏">
              ›
            </button>
          </div>
        </section>

        {/* 为你推荐 */}
        <section className="etx-ph-recommend" aria-label="为你推荐">
          <div className="etx-ph-rec-banner" style={recommendBannerStyle}>
            <div className="etx-ph-rec-banner-overlay">
              <span className="etx-ph-rec-banner-title">为你推荐</span>
            </div>
          </div>
          <div className="etx-ph-rec-list">
            <ul className="etx-ph-rec-col">
              {recommendLeft.map((item) => (
                <li key={item.t}>
                  <a className="etx-ph-rec-link fake" href="#n" onClick={(e) => e.preventDefault()}>
                    <span className="etx-ph-rec-dot" aria-hidden />
                    <span className="etx-ph-rec-text">{item.t}</span>
                    <span className="etx-ph-rec-date">{item.d}</span>
                  </a>
                </li>
              ))}
            </ul>
            <ul className="etx-ph-rec-col">
              {recommendRight.map((item) => (
                <li key={item.t}>
                  <a className="etx-ph-rec-link fake" href="#n" onClick={(e) => e.preventDefault()}>
                    <span className="etx-ph-rec-dot" aria-hidden />
                    <span className="etx-ph-rec-text">{item.t}</span>
                    <span className="etx-ph-rec-date">{item.d}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 页脚 */}
        <footer className="etx-ph-footer" aria-label="页面页脚">
          <div className="etx-ph-footer-main">
            <div className="etx-ph-footer-left">
              <p>主办单位：国家税务总局河北省税务局</p>
              <p>版权所有：国家税务总局</p>
              <p>地址：石家庄市平安南大街35号</p>
            </div>
            <img className="etx-ph-footer-seal" src={`${ETAX_PUBLIC}gov-badge.png`} alt="政府网站找错" />
          </div>
          <div className="etx-ph-footer-bottom">
            <span>网站标识码：bm29030010</span>
            <span>冀ICP备13002433号-1</span>
            <span className="etx-ph-footer-police">
              <img className="etx-ph-police-ic" src={`${ETAX_PUBLIC}beian-badge.png`} alt="" aria-hidden />
              冀公网安备 13010402001756号
            </span>
          </div>
        </footer>
      </div>
    </div>
  )
}
