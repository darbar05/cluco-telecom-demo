import { NavLink, useLocation } from 'react-router-dom'
import { useState, createContext, useContext } from 'react'
import {
  LayoutDashboard, Activity, Bot, Users, GitBranch,
  DollarSign, Zap, ChevronLeft, ChevronRight, Plus,
  Search, Radio, PanelLeftClose, PanelLeft,
  Award, FileText, GitCompare, Bell, Radio as RadioIcon, Mail, MessageSquare,
  FlaskConical, Play, Database, Clock, Settings, ClipboardList, Layers, TestTube2,
} from 'lucide-react'

const SidebarContext = createContext({ collapsed: false })

export function useSidebarCollapsed() {
  return useContext(SidebarContext)
}

const navGroups = [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: LayoutDashboard, exact: true },
      { to: '/traces', label: 'Traces', icon: Activity },
      { to: '/sessions', label: 'Sessions', icon: Users },
      { to: '/agents', label: 'Agents', icon: Bot },
    ],
  },
  {
    label: 'Deep Dive',
    items: [
      { to: '/llm-calls', label: 'LLM Calls', icon: Zap },
      { to: '/cost-analytics', label: 'Cost & Tokens', icon: DollarSign },
      { to: '/prompt-registry', label: 'Prompts', icon: FileText },
    ],
  },
  {
    label: 'Evaluation',
    items: [
      { to: '/evaluations', label: 'Evaluations Hub', icon: FlaskConical, exact: true },
      { to: '/evaluations/run', label: 'Run Evaluation', icon: Play },
      { to: '/evaluations/experiments', label: 'Experiments', icon: TestTube2 },
      { to: '/evaluations/datasets', label: 'Datasets', icon: Database },
      { to: '/evaluations/suites', label: 'Eval Suites', icon: Layers },
      { to: '/evaluations/scheduled', label: 'Scheduled', icon: Clock },
    ],
  },
  {
    label: 'Annotation',
    items: [
      { to: '/annotation-queues', label: 'Annotation Queues', icon: ClipboardList },
      { to: '/score-configs', label: 'Score Configs', icon: Settings },
      { to: '/labeling-sessions', label: 'Labeling Sessions', icon: MessageSquare },
    ],
  },
  {
    label: 'Tools',
    items: [
      { to: '/agent-flow', label: 'Agent Flow', icon: GitBranch },
      { to: '/trace-comparison', label: 'Compare', icon: GitCompare },
      { to: '/live-monitor', label: 'Live Monitor', icon: RadioIcon },
      { to: '/alerts', label: 'Alerts', icon: Bell },
      { to: '/alert-config', label: 'Email Alerts', icon: Mail },
    ],
  },
]

export { SidebarContext }

export default function Sidebar({ collapsed, onToggle }) {
  const location = useLocation()

  return (
    <aside
      className={`fixed left-0 top-0 bottom-0 z-40 flex flex-col bg-sidebar-bg border-r border-sidebar-border transition-all duration-200 ${
        collapsed ? 'w-[60px]' : 'w-[240px]'
      }`}
    >
      <div className={`flex items-center h-14 px-4 border-b border-sidebar-border ${collapsed ? 'justify-center' : 'justify-between'}`}>
        {!collapsed && (
          <NavLink to="/dashboard" className="flex items-center gap-2.5 hover:opacity-90 transition-opacity">
            <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
              <Radio size={15} className="text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white leading-none">Cluco</div>
              <div className="text-2xs text-sidebar-text leading-none mt-0.5">Observability</div>
            </div>
          </NavLink>
        )}
        {collapsed && (
          <NavLink to="/dashboard">
            <div className="w-7 h-7 rounded-lg bg-brand-600 flex items-center justify-center">
              <Radio size={15} className="text-white" />
            </div>
          </NavLink>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {navGroups.map((group) => (
          <div key={group.label} className="mb-4">
            {!collapsed && (
              <div className="px-3 mb-1.5 text-2xs font-semibold uppercase tracking-widest text-sidebar-text/60">
                {group.label}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = item.exact
                  ? location.pathname === item.to
                  : location.pathname.startsWith(item.to) && item.to !== '/'
                    ? true
                    : location.pathname === item.to

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 group ${
                      isActive
                        ? 'bg-sidebar-active text-sidebar-text-active'
                        : 'text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-active'
                    } ${collapsed ? 'justify-center px-0' : ''}`}
                    title={collapsed ? item.label : undefined}
                  >
                    <item.icon size={18} className={isActive ? 'text-brand-400' : 'text-sidebar-text group-hover:text-slate-300'} />
                    {!collapsed && <span>{item.label}</span>}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-2 border-t border-sidebar-border">
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sidebar-text hover:bg-sidebar-hover hover:text-sidebar-text-active transition-colors text-sm"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          {!collapsed && <span className="text-xs">Collapse</span>}
        </button>
      </div>
    </aside>
  )
}
