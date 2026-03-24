import { useState, useEffect, useCallback } from 'react'
import {
  getEmailRecipients, addEmailRecipient, updateEmailRecipient, deleteEmailRecipient,
  getAlertRules, createAlertRule, updateAlertRule, deleteAlertRule, toggleAlertRule,
  getSmtpConfig, saveSmtpConfig, sendTestEmail, getEmailAlertHistory,
  getEvaluators, sendAlertEmail,
} from '../api'
import {
  Mail, Bell, Settings, Plus, Trash2, Edit2, Power, Send,
  CheckCircle, XCircle, AlertTriangle, Clock, Save, X, ToggleLeft, ToggleRight, History,
  RefreshCw, ChevronDown, ChevronUp, Eye, Copy, Check, ExternalLink,
} from 'lucide-react'
import PageHeader from '../components/ui/PageHeader'
import { SkeletonTable } from '../components/ui/Skeleton'
import EmptyState from '../components/ui/EmptyState'
import Pagination from '../components/ui/Pagination'
import { useClientPagination } from '../hooks/useClientPagination'

const TABS = [
  { id: 'rules', label: 'Alert Rules', icon: Bell },
  { id: 'recipients', label: 'Recipients', icon: Mail },
  { id: 'smtp', label: 'SMTP Settings', icon: Settings },
  { id: 'history', label: 'Email History', icon: History },
]

const METRICS = [
  { value: 'total_cost_usd', label: 'Total Cost (USD)' },
  { value: 'total_tokens', label: 'Total Tokens' },
  { value: 'latency_ms', label: 'Latency (ms)' },
  { value: 'status_error', label: 'Error (1 = error trace)' },
  { value: 'span_count', label: 'Span Count' },
  { value: 'evaluator_result', label: 'Evaluator Result (True/False)' },
]

const OPERATORS = [
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'eq', label: '=' },
  { value: 'neq', label: '!=' },
]

const SEVERITIES = ['warning', 'critical']

// ── Main Page ──────────────────────────────────────────────────────────

export default function AlertConfigPage() {
  const [tab, setTab] = useState('rules')

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="Alert Configuration"
        subtitle="Configure email recipients, alert rules, and SMTP settings"
        icon={Mail}
      />

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1 mb-6 w-fit">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-md transition-colors ${
              tab === t.id ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <t.icon size={14} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'rules' && <RulesTab />}
      {tab === 'recipients' && <RecipientsTab />}
      {tab === 'smtp' && <SmtpTab />}
      {tab === 'history' && <HistoryTab />}
    </div>
  )
}


// ── Rules Tab ──────────────────────────────────────────────────────────

function RulesTab() {
  const [allRules, setAllRules] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [recipients, setRecipients] = useState([])
  const [evaluators, setEvaluators] = useState([])
  const rulesPg = useClientPagination(allRules)
  const rules = allRules

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rr, recp, evalResp] = await Promise.all([
        getAlertRules(),
        getEmailRecipients(),
        getEvaluators({ enabled: true }).catch(() => ({ data: { evaluators: [] } })),
      ])
      setAllRules(rr.data.rules || [])
      setRecipients(recp.data.recipients || [])
      setEvaluators(evalResp.data?.evaluators || evalResp.data || [])
    } catch { setAllRules([]) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleToggle = async (rule) => {
    try {
      await toggleAlertRule(rule._id, !rule.enabled)
      load()
    } catch (e) { console.error(e) }
  }

  const handleDelete = async (rule) => {
    if (!confirm(`Delete rule "${rule.name}"?`)) return
    try {
      await deleteAlertRule(rule._id)
      load()
    } catch (e) { console.error(e) }
  }

  const handleSave = async (formData) => {
    try {
      if (editing && editing._id) {
        await updateAlertRule(editing._id, formData)
      } else {
        await createAlertRule(formData)
      }
      setEditing(null)
      load()
    } catch (e) { console.error(e) }
  }

  if (loading) return <SkeletonTable rows={4} cols={5} />

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-xs text-slate-500">{rules.length} rule{rules.length !== 1 ? 's' : ''} configured</p>
        <button onClick={() => setEditing('new')} className="btn-primary text-xs flex items-center gap-1.5">
          <Plus size={14} /> New Rule
        </button>
      </div>

      {editing && (
        <RuleForm
          rule={editing === 'new' ? null : editing}
          recipients={recipients}
          evaluators={evaluators}
          onSave={handleSave}
          onCancel={() => setEditing(null)}
        />
      )}

      {rules.length === 0 && !editing ? (
        <EmptyState icon={Bell} title="No alert rules" description="Create a rule to start receiving email alerts when metrics exceed thresholds." />
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-left w-8"></th>
                <th className="text-left">Name</th>
                <th className="text-left">Condition</th>
                <th className="text-left">Severity</th>
                <th className="text-right">Triggers</th>
                <th className="text-left">Last Fired</th>
                <th className="text-center w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rulesPg.paginatedData.map((rule) => {
                const cond = rule.condition || {}
                const opLabel = OPERATORS.find(o => o.value === cond.operator)?.label || cond.operator
                const metricLabel = METRICS.find(m => m.value === cond.metric)?.label || cond.metric
                const isEvalRule = cond.metric === 'evaluator_result'
                return (
                  <tr key={rule._id} className={!rule.enabled ? 'opacity-40' : ''}>
                    <td>
                      <button onClick={() => handleToggle(rule)} className="text-slate-400 hover:text-brand-600 transition-colors" title={rule.enabled ? 'Disable' : 'Enable'}>
                        {rule.enabled ? <ToggleRight size={18} className="text-green-500" /> : <ToggleLeft size={18} />}
                      </button>
                    </td>
                    <td>
                      <div className="text-sm font-medium text-slate-800">{rule.name}</div>
                      {rule.description && <div className="text-2xs text-slate-400 mt-0.5">{rule.description}</div>}
                      {rule.product_id && <div className="text-2xs text-brand-500 mt-0.5">Product: {rule.product_id}</div>}
                    </td>
                    <td>
                      {isEvalRule ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs bg-violet-50 text-violet-700 px-2 py-0.5 rounded font-medium">{cond.evaluator_name || '?'}</span>
                          <span className="text-xs text-slate-400">=</span>
                          <span className={`text-xs font-semibold ${cond.expected_value === 'True' ? 'text-green-600' : 'text-red-600'}`}>
                            {cond.expected_value === 'True' ? 'Pass' : 'Fail'}
                          </span>
                        </div>
                      ) : (
                        <code className="text-xs bg-slate-50 px-2 py-0.5 rounded">
                          {metricLabel} {opLabel} {cond.threshold}
                        </code>
                      )}
                    </td>
                    <td>
                      <span className={`text-xs font-medium ${rule.severity === 'critical' ? 'text-red-600' : 'text-amber-600'}`}>
                        {rule.severity}
                      </span>
                    </td>
                    <td className="text-right">
                      <span className="text-xs text-slate-600 font-mono">{rule.trigger_count || 0}</span>
                      {rule.cooldown_minutes > 0 && (
                        <div className="text-2xs text-slate-400 flex items-center justify-end gap-0.5 mt-0.5">
                          <Clock size={9} /> {rule.cooldown_minutes}m cooldown
                        </div>
                      )}
                    </td>
                    <td className="text-xs text-slate-400">
                      {rule.last_triggered_at ? new Date(rule.last_triggered_at).toLocaleString() : 'Never'}
                    </td>
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => setEditing(rule)} className="p-1 text-slate-400 hover:text-brand-600 transition-colors" title="Edit">
                          <Edit2 size={14} />
                        </button>
                        <button onClick={() => handleDelete(rule)} className="p-1 text-slate-400 hover:text-red-600 transition-colors" title="Delete">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <Pagination currentPage={rulesPg.page} totalItems={rulesPg.totalItems} pageSize={rulesPg.pageSize} onPageChange={rulesPg.setPage} onPageSizeChange={rulesPg.setPageSize} />
        </div>
      )}
    </div>
  )
}


// ── Rule Form ──────────────────────────────────────────────────────────

function RuleForm({ rule, recipients, evaluators = [], onSave, onCancel }) {
  const [form, setForm] = useState({
    name: rule?.name || '',
    description: rule?.description || '',
    severity: rule?.severity || 'warning',
    alert_type: rule?.alert_type || 'rule_triggered',
    enabled: rule?.enabled ?? true,
    condition: {
      metric: rule?.condition?.metric || 'total_cost_usd',
      operator: rule?.condition?.operator || 'gt',
      threshold: rule?.condition?.threshold ?? 0,
      evaluator_name: rule?.condition?.evaluator_name || '',
      expected_value: rule?.condition?.expected_value || 'False',
    },
    recipient_ids: rule?.recipient_ids || [],
    cooldown_minutes: rule?.cooldown_minutes || 0,
    product_id: rule?.product_id || '',
  })

  const isEvaluatorMetric = form.condition.metric === 'evaluator_result'

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }))
  const setCond = (key, val) => setForm(f => ({ ...f, condition: { ...f.condition, [key]: val } }))

  const toggleRecipient = (id) => {
    setForm(f => {
      const ids = f.recipient_ids.includes(id)
        ? f.recipient_ids.filter(r => r !== id)
        : [...f.recipient_ids, id]
      return { ...f, recipient_ids: ids }
    })
  }

  return (
    <div className="card p-5 border-brand-200 bg-brand-50/30">
      <div className="flex justify-between items-center mb-4">
        <h3 className="text-sm font-semibold text-slate-800">{rule ? 'Edit Rule' : 'New Alert Rule'}</h3>
        <button onClick={onCancel} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Rule Name *</label>
          <input value={form.name} onChange={e => set('name', e.target.value)}
            className="input-field w-full" placeholder="e.g. High Cost Alert" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Description</label>
          <input value={form.description} onChange={e => set('description', e.target.value)}
            className="input-field w-full" placeholder="Optional description" />
        </div>
      </div>

      {/* Condition */}
      <div className="mb-4">
        <label className="block text-xs font-semibold text-slate-700 mb-2">Condition</label>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500">When</span>
          <select value={form.condition.metric} onChange={e => setCond('metric', e.target.value)}
            className="select-field text-xs py-1.5">
            {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          {isEvaluatorMetric ? (
            <>
              <select
                value={form.condition.evaluator_name || ''}
                onChange={e => setCond('evaluator_name', e.target.value)}
                className="select-field text-xs py-1.5 min-w-[180px]"
              >
                <option value="">— Select Evaluator —</option>
                {evaluators.map(ev => (
                  <option key={ev.evaluator_id || ev._id || ev.name} value={ev.name}>
                    {ev.name}{ev.category ? ` (${ev.category})` : ''}
                  </option>
                ))}
              </select>
              {form.condition.evaluator_name && !evaluators.some(ev => ev.name === form.condition.evaluator_name) && (
                <span className="text-[10px] text-amber-600 bg-amber-50 px-2 py-0.5 rounded">
                  Custom: {form.condition.evaluator_name}
                </span>
              )}
              <span className="text-xs text-slate-500">returns</span>
              <select value={form.condition.expected_value || 'False'} onChange={e => setCond('expected_value', e.target.value)}
                className="select-field text-xs py-1.5 w-24">
                <option value="True">Pass (True)</option>
                <option value="False">Fail (False)</option>
              </select>
            </>
          ) : (
            <>
              <select value={form.condition.operator} onChange={e => setCond('operator', e.target.value)}
                className="select-field text-xs py-1.5 w-16">
                {OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <input type="number" value={form.condition.threshold} onChange={e => setCond('threshold', parseFloat(e.target.value) || 0)}
                className="input-field w-28 text-xs" placeholder="Threshold" />
            </>
          )}
        </div>
        {isEvaluatorMetric && (
          <div className="mt-2 ml-8">
            <label className="block text-[10px] text-slate-400 mb-1">Or type a custom evaluator name:</label>
            <input
              value={form.condition.evaluator_name || ''}
              onChange={e => setCond('evaluator_name', e.target.value)}
              className="input-field w-60 text-xs"
              placeholder="custom_evaluator_name"
            />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Severity</label>
          <select value={form.severity} onChange={e => set('severity', e.target.value)}
            className="select-field text-xs py-1.5 w-full">
            {SEVERITIES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Cooldown (min)</label>
          <input type="number" value={form.cooldown_minutes} onChange={e => set('cooldown_minutes', parseInt(e.target.value) || 0)}
            className="input-field w-full text-xs" placeholder="0 = no cooldown" min={0} />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Product Filter</label>
          <input value={form.product_id} onChange={e => set('product_id', e.target.value)}
            className="input-field w-full text-xs" placeholder="All products" />
        </div>
      </div>

      {/* Recipient Selection */}
      {recipients.length > 0 && (
        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-700 mb-2">
            Recipients <span className="font-normal text-slate-400">(leave empty = all active recipients)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {recipients.map(r => (
              <button
                key={r._id}
                onClick={() => toggleRecipient(r._id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-colors ${
                  form.recipient_ids.includes(r._id)
                    ? 'bg-brand-50 border-brand-300 text-brand-700'
                    : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                }`}
              >
                <Mail size={12} />
                {r.name} <span className="text-slate-400">({r.email})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="btn-ghost text-xs">Cancel</button>
        <button
          onClick={() => onSave(form)}
          disabled={!form.name.trim() || (isEvaluatorMetric && !form.condition.evaluator_name)}
          className="btn-primary text-xs flex items-center gap-1.5"
        >
          <Save size={14} /> {rule ? 'Update Rule' : 'Create Rule'}
        </button>
      </div>
    </div>
  )
}


// ── Recipients Tab ────────────────────────────────────────────────────

function RecipientsTab() {
  const [allRecipients, setAllRecipients] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState({ name: '', email: '', active: true })
  const recipPg = useClientPagination(allRecipients)
  const recipients = allRecipients

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await getEmailRecipients()
      setAllRecipients(r.data.recipients || [])
    } catch { setRecipients([]) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (!form.name.trim() || !form.email.trim()) return
    try {
      await addEmailRecipient(form)
      setForm({ name: '', email: '', active: true })
      setShowAdd(false)
      load()
    } catch (e) { console.error(e) }
  }

  const handleUpdate = async (id) => {
    if (!form.name.trim() || !form.email.trim()) return
    try {
      await updateEmailRecipient(id, form)
      setEditingId(null)
      setForm({ name: '', email: '', active: true })
      load()
    } catch (e) { console.error(e) }
  }

  const handleDelete = async (id, name) => {
    if (!confirm(`Remove recipient "${name}"?`)) return
    try {
      await deleteEmailRecipient(id)
      load()
    } catch (e) { console.error(e) }
  }

  const startEdit = (r) => {
    setEditingId(r._id)
    setForm({ name: r.name, email: r.email, active: r.active })
    setShowAdd(false)
  }

  if (loading) return <SkeletonTable rows={3} cols={4} />

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-xs text-slate-500">{recipients.length} recipient{recipients.length !== 1 ? 's' : ''}</p>
        <button onClick={() => { setShowAdd(true); setEditingId(null); setForm({ name: '', email: '', active: true }) }} className="btn-primary text-xs flex items-center gap-1.5">
          <Plus size={14} /> Add Recipient
        </button>
      </div>

      {(showAdd || editingId) && (
        <div className="card p-4 border-brand-200 bg-brand-50/30">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-sm font-semibold text-slate-800">{editingId ? 'Edit Recipient' : 'Add Recipient'}</h3>
            <button onClick={() => { setShowAdd(false); setEditingId(null) }} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[180px]">
              <label className="block text-xs font-medium text-slate-600 mb-1">Name</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="input-field w-full" placeholder="John Doe" />
            </div>
            <div className="flex-1 min-w-[220px]">
              <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
              <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="input-field w-full" placeholder="john@example.com" />
            </div>
            <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer pb-1">
              <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))}
                className="rounded border-slate-300" />
              Active
            </label>
            <button
              onClick={editingId ? () => handleUpdate(editingId) : handleAdd}
              disabled={!form.name.trim() || !form.email.trim()}
              className="btn-primary text-xs flex items-center gap-1.5"
            >
              <Save size={14} /> {editingId ? 'Update' : 'Add'}
            </button>
          </div>
        </div>
      )}

      {recipients.length === 0 && !showAdd ? (
        <EmptyState icon={Mail} title="No recipients" description="Add email addresses to receive alert notifications." />
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-left">Name</th>
                <th className="text-left">Email</th>
                <th className="text-center">Status</th>
                <th className="text-left">Added</th>
                <th className="text-center w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recipPg.paginatedData.map(r => (
                <tr key={r._id} className={!r.active ? 'opacity-40' : ''}>
                  <td className="text-sm font-medium text-slate-800">{r.name}</td>
                  <td className="text-xs text-slate-600 font-mono">{r.email}</td>
                  <td className="text-center">
                    {r.active
                      ? <span className="inline-flex items-center gap-1 text-xs text-green-600"><CheckCircle size={12} /> Active</span>
                      : <span className="inline-flex items-center gap-1 text-xs text-slate-400"><XCircle size={12} /> Inactive</span>
                    }
                  </td>
                  <td className="text-xs text-slate-400">{r.created_at ? new Date(r.created_at).toLocaleDateString() : '-'}</td>
                  <td className="text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => startEdit(r)} className="p-1 text-slate-400 hover:text-brand-600 transition-colors" title="Edit">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => handleDelete(r._id, r.name)} className="p-1 text-slate-400 hover:text-red-600 transition-colors" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination currentPage={recipPg.page} totalItems={recipPg.totalItems} pageSize={recipPg.pageSize} onPageChange={recipPg.setPage} onPageSizeChange={recipPg.setPageSize} />
        </div>
      )}
    </div>
  )
}


// ── SMTP Settings Tab ─────────────────────────────────────────────────

function SmtpTab() {
  const [config, setConfig] = useState({
    host: '', port: 587, username: '', password: '',
    from_email: 'alerts@cluco-observability.local', from_name: 'Cluco Observability',
    use_tls: true, enabled: false,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testEmail, setTestEmail] = useState('')
  const [testResult, setTestResult] = useState(null)
  const [sendingTest, setSendingTest] = useState(false)
  const [source, setSource] = useState('none')
  const [showOverride, setShowOverride] = useState(false)

  useEffect(() => {
    (async () => {
      setLoading(true)
      try {
        const r = await getSmtpConfig()
        if (r.data.smtp) setConfig(r.data.smtp)
        setSource(r.data.source || 'none')
      } catch {} finally { setLoading(false) }
    })()
  }, [])

  const set = (key, val) => setConfig(c => ({ ...c, [key]: val }))

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveSmtpConfig(config)
      setSaving(false)
    } catch (e) {
      console.error(e)
      setSaving(false)
    }
  }

  const handleTest = async () => {
    if (!testEmail.trim()) return
    setSendingTest(true)
    setTestResult(null)
    try {
      const r = await sendTestEmail(testEmail)
      setTestResult(r.data)
    } catch (e) {
      setTestResult({ ok: false, error: e.response?.data?.detail || e.message })
    } finally { setSendingTest(false) }
  }

  if (loading) return <SkeletonTable rows={4} cols={2} />

  const isEnvConfigured = source === 'env'

  return (
    <div className="space-y-6 max-w-2xl">
      {isEnvConfigured && (
        <div className="card p-5 border-emerald-200 bg-emerald-50/30">
          <div className="flex items-start gap-3">
            <CheckCircle size={18} className="text-emerald-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-emerald-800">SMTP configured via backend environment variables (.env)</h3>
              <p className="text-xs text-emerald-600 mt-1">Email alerts are ready. Configuration is managed in the backend .env file.</p>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div><span className="text-2xs text-slate-400">Host</span><div className="text-xs font-mono text-slate-700">{config.host || '-'}</div></div>
                <div><span className="text-2xs text-slate-400">Port</span><div className="text-xs font-mono text-slate-700">{config.port || '-'}</div></div>
                <div><span className="text-2xs text-slate-400">Username</span><div className="text-xs font-mono text-slate-700">{config.username || '-'}</div></div>
                <div><span className="text-2xs text-slate-400">From</span><div className="text-xs font-mono text-slate-700">{config.from_email || '-'}</div></div>
              </div>
              <button
                onClick={() => setShowOverride(!showOverride)}
                className="text-xs text-emerald-700 hover:text-emerald-900 font-medium mt-3 underline"
              >
                {showOverride ? 'Hide override form' : 'Override via UI (advanced)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {(!isEnvConfigured || showOverride) && (
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <Settings size={16} className="text-brand-600" /> SMTP Server
          {isEnvConfigured && <span className="text-2xs text-amber-600 font-normal">(Override)</span>}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">SMTP Host</label>
            <input value={config.host} onChange={e => set('host', e.target.value)}
              className="input-field w-full" placeholder="smtp.gmail.com" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Port</label>
            <input type="number" value={config.port} onChange={e => set('port', parseInt(e.target.value) || 587)}
              className="input-field w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Username</label>
            <input value={config.username} onChange={e => set('username', e.target.value)}
              className="input-field w-full" placeholder="user@gmail.com" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Password / App Password</label>
            <input type="password" value={config.password} onChange={e => set('password', e.target.value)}
              className="input-field w-full" placeholder="••••••••" />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">From Email</label>
            <input value={config.from_email} onChange={e => set('from_email', e.target.value)}
              className="input-field w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">From Name</label>
            <input value={config.from_name} onChange={e => set('from_name', e.target.value)}
              className="input-field w-full" />
          </div>
        </div>

        <div className="flex items-center gap-6 mt-4">
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={config.use_tls} onChange={e => set('use_tls', e.target.checked)}
              className="rounded border-slate-300" />
            Use TLS
          </label>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={config.enabled} onChange={e => set('enabled', e.target.checked)}
              className="rounded border-slate-300" />
            <span className={config.enabled ? 'text-green-600 font-semibold' : 'text-slate-600'}>
              {config.enabled ? 'Email alerts enabled' : 'Email alerts disabled'}
            </span>
          </label>
        </div>

        <div className="flex justify-end mt-5">
          <button onClick={handleSave} disabled={saving} className="btn-primary text-xs flex items-center gap-1.5">
            <Save size={14} /> {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
      )}

      {/* Test Email */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <Send size={16} className="text-brand-600" /> Test Email
        </h3>
        <p className="text-xs text-slate-500 mb-3">Send a test email to verify your SMTP configuration is working correctly.</p>

        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-600 mb-1">Recipient Email</label>
            <input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)}
              className="input-field w-full" placeholder="test@example.com" />
          </div>
          <button onClick={handleTest} disabled={sendingTest || !testEmail.trim()} className="btn-primary text-xs flex items-center gap-1.5">
            <Send size={14} /> {sendingTest ? 'Sending...' : 'Send Test'}
          </button>
        </div>

        {testResult && (
          <div className={`mt-3 p-3 rounded-lg text-xs flex items-center gap-2 ${
            testResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {testResult.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
            {testResult.ok ? 'Test email sent successfully!' : `Failed: ${testResult.error}`}
          </div>
        )}
      </div>

      {/* Help */}
      <div className="card p-5 bg-slate-50 border-slate-200">
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Setup Guide</h3>
        <div className="text-xs text-slate-500 space-y-2">
          <p><strong>Gmail:</strong> Use <code className="bg-white px-1.5 py-0.5 rounded text-slate-700">smtp.gmail.com</code> port 587 with an <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener" className="text-brand-600 hover:underline">App Password</a>.</p>
          <p><strong>Outlook:</strong> Use <code className="bg-white px-1.5 py-0.5 rounded text-slate-700">smtp-mail.outlook.com</code> port 587.</p>
          <p><strong>Custom SMTP:</strong> Enter your SMTP server details. Contact your email admin for credentials.</p>
          <p className="text-slate-400 mt-2">Credentials are stored securely in MongoDB. Passwords are never exposed to the frontend.</p>
        </div>
      </div>
    </div>
  )
}


// ── Email History Tab ─────────────────────────────────────────────────

function HistoryTab() {
  const [allAlerts, setAllAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [resending, setResending] = useState(null)
  const [resendResult, setResendResult] = useState(null)
  const [days, setDays] = useState(30)
  const histPg = useClientPagination(allAlerts)
  const alerts = allAlerts

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await getEmailAlertHistory({ days, limit: 200 })
      setAllAlerts(r.data.alerts || [])
    } catch { setAllAlerts([]) } finally { setLoading(false) }
  }, [days])

  useEffect(() => { load() }, [load])

  const handleResend = async (alertId) => {
    setResending(alertId)
    setResendResult(null)
    try {
      const r = await sendAlertEmail(alertId)
      setResendResult({ id: alertId, ok: r.data.ok, error: r.data.error || '' })
      load()
    } catch (e) {
      setResendResult({ id: alertId, ok: false, error: e.response?.data?.detail || e.message })
    } finally { setResending(null) }
  }

  const handleRetryAllFailed = async () => {
    const failedAlerts = alerts.filter(a => a.email_status === 'failed' && a._id)
    if (!failedAlerts.length) return
    setResending('all')
    setResendResult(null)
    let succeeded = 0, errors = 0
    for (const a of failedAlerts) {
      try {
        const r = await sendAlertEmail(a._id)
        if (r.data.ok) succeeded++; else errors++
      } catch { errors++ }
    }
    setResendResult({ id: 'all', ok: errors === 0, error: errors > 0 ? `${succeeded} sent, ${errors} failed` : `All ${succeeded} emails resent successfully` })
    setResending(null)
    load()
  }

  const statusBadge = (status) => {
    if (status === 'sent') return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full">
        <CheckCircle size={11} /> Sent
      </span>
    )
    if (status === 'failed') return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full">
        <XCircle size={11} /> Failed
      </span>
    )
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full">
        <Clock size={11} /> Unknown
      </span>
    )
  }

  if (loading) return <SkeletonTable rows={5} cols={6} />

  const sentCount = alerts.filter(a => a.email_status === 'sent').length
  const failedCount = alerts.filter(a => a.email_status === 'failed').length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-4">
          <p className="text-xs text-slate-500">{alerts.length} email alert{alerts.length !== 1 ? 's' : ''}</p>
          {sentCount > 0 && <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle size={11} /> {sentCount} sent</span>}
          {failedCount > 0 && (
            <span className="flex items-center gap-2">
              <span className="text-xs text-red-600 flex items-center gap-1"><XCircle size={11} /> {failedCount} failed</span>
              <button
                onClick={handleRetryAllFailed}
                disabled={resending === 'all'}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-50"
              >
                {resending === 'all' ? <RefreshCw size={11} className="animate-spin" /> : <RefreshCw size={11} />}
                Retry All Failed
              </button>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400">Period:</label>
          <select value={days} onChange={e => setDays(parseInt(e.target.value))} className="select-field text-xs py-1">
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={60}>Last 60 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button onClick={load} className="p-1.5 text-slate-400 hover:text-brand-600 rounded-lg hover:bg-slate-50 transition-colors" title="Refresh">
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {resendResult && (
        <div className={`px-3 py-2 rounded-lg text-xs flex items-center gap-2 ${
          resendResult.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {resendResult.ok ? <CheckCircle size={14} /> : <XCircle size={14} />}
          {resendResult.ok ? 'Email resent successfully!' : `Resend failed: ${resendResult.error}`}
          <button onClick={() => setResendResult(null)} className="ml-auto text-slate-400 hover:text-slate-600"><X size={12} /></button>
        </div>
      )}

      {alerts.length === 0 ? (
        <EmptyState icon={History} title="No email alerts yet" description="When alert rules trigger, email notifications and their history will appear here." />
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th className="text-left w-8"></th>
                <th className="text-left">Status</th>
                <th className="text-left">Severity</th>
                <th className="text-left">Rule / Subject</th>
                <th className="text-left">Recipients</th>
                <th className="text-left">Date</th>
                <th className="text-center w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {histPg.paginatedData.map((a, i) => {
                const details = a.details || {}
                const sentTo = a.email_recipients || details.email_sent_to || []
                const isExpanded = expandedId === (a._id || i)
                return (
                  <>
                    <tr key={a._id || i} className={`cursor-pointer hover:bg-slate-50 transition-colors ${isExpanded ? 'bg-slate-50' : ''}`}>
                      <td>
                        <button onClick={() => setExpandedId(isExpanded ? null : (a._id || i))} className="text-slate-400 hover:text-slate-600 transition-colors">
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </td>
                      <td>{statusBadge(a.email_status)}</td>
                      <td>
                        <span className={`text-xs font-medium ${a.severity === 'critical' ? 'text-red-600' : 'text-amber-600'}`}>
                          {a.severity === 'critical' ? <AlertTriangle size={12} className="inline mr-1" /> : <Bell size={12} className="inline mr-1" />}
                          {a.severity}
                        </span>
                      </td>
                      <td>
                        <div className="text-xs font-medium text-slate-700">{details.rule_name || '-'}</div>
                        {a.email_subject && <div className="text-2xs text-slate-400 mt-0.5 truncate max-w-xs" title={a.email_subject}>{a.email_subject}</div>}
                      </td>
                      <td className="text-xs text-slate-500">
                        {sentTo.length > 0 ? (
                          <div className="space-y-0.5">
                            {sentTo.slice(0, 2).map((e, idx) => <div key={idx} className="truncate max-w-[180px]">{e}</div>)}
                            {sentTo.length > 2 && <div className="text-2xs text-slate-400">+{sentTo.length - 2} more</div>}
                          </div>
                        ) : '-'}
                      </td>
                      <td className="text-xs text-slate-400 whitespace-nowrap">
                        {a.created_at ? new Date(a.created_at).toLocaleString() : '-'}
                      </td>
                      <td className="text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); setExpandedId(isExpanded ? null : (a._id || i)) }}
                            className="p-1 text-slate-400 hover:text-brand-600 transition-colors"
                            title="View Details"
                          >
                            <Eye size={14} />
                          </button>
                          {a.email_status === 'failed' ? (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleResend(a._id) }}
                              disabled={resending === a._id}
                              className="flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 transition-colors disabled:opacity-50"
                            >
                              {resending === a._id ? <RefreshCw size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                              Retry
                            </button>
                          ) : (
                            <button
                              onClick={(e) => { e.stopPropagation(); handleResend(a._id) }}
                              disabled={resending === a._id}
                              className="p-1 text-slate-400 hover:text-green-600 transition-colors disabled:opacity-40"
                              title="Resend Email"
                            >
                              {resending === a._id ? <RefreshCw size={14} className="animate-spin" /> : <Send size={14} />}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${a._id || i}-detail`}>
                        <td colSpan={7} className="p-0">
                          <EmailDetailPanel alert={a} />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
          <Pagination currentPage={histPg.page} totalItems={histPg.totalItems} pageSize={histPg.pageSize} onPageChange={histPg.setPage} onPageSizeChange={histPg.setPageSize} />
        </div>
      )}
    </div>
  )
}


// ── Email Detail Panel (expanded row) ──────────────────────────────────

function EmailDetailPanel({ alert }) {
  const [showHtml, setShowHtml] = useState(false)
  const [copied, setCopied] = useState(false)
  const details = alert.details || {}
  const sentTo = alert.email_recipients || details.email_sent_to || []

  const handleCopy = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div className="bg-slate-50 border-t border-slate-200 p-4 space-y-4 animate-fade-in">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: Alert Info */}
        <div className="space-y-3">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Alert Message</span>
            <p className="text-sm text-slate-700 mt-1">{alert.message || '-'}</p>
          </div>

          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Trace ID</span>
            <div className="flex items-center gap-2 mt-1">
              <code className="text-xs font-mono bg-white px-2 py-0.5 rounded border border-slate-200 text-slate-600">
                {alert.trace_id || '-'}
              </code>
              {alert.trace_id && (
                <a href={`/traces/${alert.trace_id}`} className="text-brand-600 hover:text-brand-700 transition-colors" title="View Trace">
                  <ExternalLink size={12} />
                </a>
              )}
            </div>
          </div>

          {Object.keys(details).length > 0 && (
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Rule Details</span>
              <div className="mt-1 space-y-1">
                {Object.entries(details).filter(([k]) => k !== 'email_sent_to' && k !== 'rule_name').map(([k, v]) => (
                  <div key={k} className="flex items-baseline gap-2">
                    <span className="text-2xs text-slate-400 min-w-[80px]">{k}:</span>
                    <span className="text-xs text-slate-700 font-medium">{String(v)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Recipients</span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {sentTo.map((email, idx) => (
                <span key={idx} className="text-xs bg-white border border-slate-200 px-2 py-0.5 rounded-full text-slate-600">
                  <Mail size={10} className="inline mr-1 text-slate-400" />{email}
                </span>
              ))}
              {sentTo.length === 0 && <span className="text-xs text-slate-400">No recipients recorded</span>}
            </div>
          </div>

          {alert.email_status === 'failed' && alert.email_error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-red-500">Error</span>
              <p className="text-xs text-red-700 mt-1 font-mono">{alert.email_error}</p>
            </div>
          )}

          {alert.last_resent_at && (
            <div className="text-2xs text-slate-400">
              Last resent: {new Date(alert.last_resent_at).toLocaleString()}
            </div>
          )}
        </div>

        {/* Right: Email Preview */}
        <div className="space-y-3">
          {alert.email_subject && (
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Email Subject</span>
                <button onClick={() => handleCopy(alert.email_subject)} className="p-0.5 text-slate-400 hover:text-slate-600 transition-colors" title="Copy">
                  {copied ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
                </button>
              </div>
              <p className="text-sm font-medium text-slate-800 mt-1 bg-white border border-slate-200 rounded-lg px-3 py-2">{alert.email_subject}</p>
            </div>
          )}

          {alert.email_body_html && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Email Body</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowHtml(!showHtml)}
                    className="text-2xs text-brand-600 hover:text-brand-700 font-medium"
                  >
                    {showHtml ? 'Preview' : 'HTML Source'}
                  </button>
                </div>
              </div>
              {showHtml ? (
                <pre className="text-[10px] font-mono bg-white border border-slate-200 rounded-lg p-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-slate-600">
                  {alert.email_body_html}
                </pre>
              ) : (
                <div
                  className="bg-white border border-slate-200 rounded-lg p-3 max-h-64 overflow-auto text-sm"
                  dangerouslySetInnerHTML={{ __html: alert.email_body_html }}
                />
              )}
            </div>
          )}

          {!alert.email_body_html && alert.email_body_text && (
            <div>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Email Body (Text)</span>
              <pre className="text-xs font-mono bg-white border border-slate-200 rounded-lg p-3 mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-slate-600">
                {alert.email_body_text}
              </pre>
            </div>
          )}

          {!alert.email_subject && !alert.email_body_html && !alert.email_body_text && (
            <div className="bg-slate-100 rounded-lg p-4 text-center">
              <p className="text-xs text-slate-400">No email content recorded for this alert.</p>
              <p className="text-2xs text-slate-400 mt-1">Older alerts may not have email body data stored.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
