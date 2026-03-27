import axios from 'axios'

// Use full backend URL when set (e.g. production or backend on another host); otherwise use relative path so Vite proxy works in dev
const envUrl = import.meta.env.VITE_API_URL
const API_BASE =
  (typeof envUrl === 'string' && envUrl.startsWith('http'))
    ? envUrl.replace(/\/$/, '') // strip trailing slash
    : '/api/v1'

export const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
})

// Surface API errors so pages don't silently show empty data
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = err.config?.baseURL && err.config?.url ? `${err.config.baseURL}${err.config.url}` : err.config?.url || 'API'
    const status = err.response?.status
    const detail = err.response?.data?.detail ?? err.message
    if (err.code === 'ECONNREFUSED' || err.message?.includes('Network Error')) {
      console.warn('[Cluco UI] Backend unreachable:', url, '- Is the Cluco backend running on port 9410?')
    } else if (status >= 400) {
      console.warn('[Cluco UI] API error', status, url, detail)
    }
    return Promise.reject(err)
  }
)

export const getTraces = (params) => api.get('/traces', { params })
export const getTrace = (traceId) => api.get(`/traces/${traceId}`)
export const debugTraceAssistant = (traceId, question, stream = false) =>
  api.post(`/traces/${traceId}/debug-assistant`, { question, stream }, { timeout: 120000 })
export const getAgents = (productId) => api.get('/agents', { params: { product_id: productId } })
export const getSessions = (params) => api.get('/sessions', { params })
export const getAgentMetrics = (serviceName, productId) => api.get(`/agents/${serviceName}/metrics`, { params: { product_id: productId } })
export const getMetrics = (productId) => api.get('/metrics', { params: { product_id: productId } })
export const getProducts = () => api.get('/products')
export const getDashboards = (productId) => api.get('/dashboards', { params: { product_id: productId } })
export const getDashboard = (id) => api.get(`/dashboards/${id}`)
export const createDashboard = (data) => api.post('/dashboards', data)
export const updateDashboard = (id, data) => api.put(`/dashboards/${id}`, data)
export const deleteDashboard = (id) => api.delete(`/dashboards/${id}`)

export const getSpans = (params) => api.get('/spans', { params })
export const getLLMCalls = (params) => api.get('/llm-calls', { params })
export const getToolCalls = (params) => api.get('/tool-calls', { params })
export const getRagQueries = (params) => api.get('/rag-queries', { params })
export const getEmbeddingCalls = (params) => api.get('/embedding-calls', { params })
export const getFeedback = (params) => api.get('/feedback', { params })
export const addFeedback = (data) => api.post('/feedback', data)
export const getSessionDetail = (sessionId) => api.get(`/sessions/${sessionId}`)
export const getAgentArchitecture = (productId) => api.get('/agent-architecture', { params: { product_id: productId } })
export const getPipeline = (productId) => api.get(`/pipelines/${productId}`)
export const getPipelines = () => api.get('/pipelines')
export const registerPipeline = (data) => api.post('/pipelines', data)
export const getAgentBreakdown = (params) => api.get('/agent-breakdown', { params })

// Evaluations (quality tracking)
export const getEvaluations = (params) => api.get('/evaluations', { params })
export const getEvaluationTrends = (params) => api.get('/evaluations/trends', { params })

// Prompt versions
export const getPromptVersions = (params) => api.get('/prompt-versions', { params })

// Trace comparison
export const compareTraces = (traceA, traceB) => api.get('/traces/compare', { params: { trace_a: traceA, trace_b: traceB } })

// Anomaly detection
export const getAnomalies = (params) => api.get('/anomalies', { params })
export const getAnomalyBaselines = (params) => api.get('/anomalies/baselines', { params })

// Alerts
export const getAlerts = (params) => api.get('/alerts', { params })
export const acknowledgeAlert = (alertId) => api.post(`/alerts/${alertId}/acknowledge`)

// Email alert system
export const getEmailRecipients = () => api.get('/email/recipients')
export const addEmailRecipient = (data) => api.post('/email/recipients', data)
export const updateEmailRecipient = (id, data) => api.put(`/email/recipients/${id}`, data)
export const deleteEmailRecipient = (id) => api.delete(`/email/recipients/${id}`)

export const getAlertRules = () => api.get('/email/rules')
export const createAlertRule = (data) => api.post('/email/rules', data)
export const updateAlertRule = (id, data) => api.put(`/email/rules/${id}`, data)
export const deleteAlertRule = (id) => api.delete(`/email/rules/${id}`)
export const toggleAlertRule = (id, enabled) => api.put(`/email/rules/${id}/toggle`, { enabled })

export const getSmtpConfig = () => api.get('/email/smtp')
export const saveSmtpConfig = (data) => api.put('/email/smtp', data)
export const sendTestEmail = (to_email) => api.post('/email/test', { to_email })
export const getEmailAlertHistory = (params) => api.get('/email/history', { params })

// Active traces (status = 'running')
export const getActiveTraces = (params) => api.get('/traces/active', { params })

// Derive backend WebSocket host — point directly to backend (port 9410),
// bypassing Vite proxy which doesn't always relay WS reliably in dev.
function _wsBackendHost() {
  if (typeof envUrl === 'string' && envUrl.startsWith('http')) {
    return new URL(envUrl).host                             // explicit backend URL
  }
  // Dev mode: UI is on 9411, backend on 9410 — connect directly to 9410
  const hostname = window.location.hostname || 'localhost'
  return `${hostname}:9410`
}

// WebSocket live trace URL helper (per-trace)
export function getLiveTraceWsUrl(traceId) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${_wsBackendHost()}/ws/traces/${traceId}/live`
}

// Global live WebSocket URL (auto-discovery — all traces)
export function getGlobalLiveWsUrl(filters = {}) {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const params = new URLSearchParams()
  if (filters.product_id) params.set('product_id', filters.product_id)
  if (filters.service_name) params.set('service_name', filters.service_name)
  const qs = params.toString()
  return `${protocol}//${_wsBackendHost()}/ws/live${qs ? '?' + qs : ''}`
}

/** Ping backend to verify connectivity (use same baseURL as other calls). */
export const getHealth = () => api.get('/health')

// ── Evaluation Framework ──────────────────────────────────────────────

// Evaluators
export const getEvaluators = (params) => api.get('/evaluators', { params })
export const createEvaluator = (data) => api.post('/evaluators', data)
export const updateEvaluator = (id, data) => api.put(`/evaluators/${id}`, data)
export const deleteEvaluator = (id) => api.delete(`/evaluators/${id}`)

// Evaluation Runs
export const runEvaluation = (data) => api.post('/evaluations/run', data, { timeout: 180000 })
export const getEvaluationRuns = (params) => api.get('/evaluations/runs', { params })
export const getEvaluationRunStats = (params) => api.get('/evaluations/runs/stats', { params })
export const getEvaluationRun = (runId) => api.get(`/evaluations/runs/${runId}`)

// Datasets
export const getDatasets = (params) => api.get('/datasets', { params })
export const createDataset = (data) => api.post('/datasets', data)
export const getDataset = (id) => api.get(`/datasets/${id}`)
export const updateDataset = (id, data) => api.put(`/datasets/${id}`, data)
export const deleteDataset = (id) => api.delete(`/datasets/${id}`)
export const addDatasetItems = (id, items) => api.post(`/datasets/${id}/items`, { items })
export const deleteDatasetItem = (id, itemId) => api.delete(`/datasets/${id}/items/${itemId}`)
export const approveDatasetItem = (id, itemId, body = {}) => api.post(`/datasets/${id}/items/${itemId}/approve`, body)
export const bulkApproveDatasetItems = (id, body = {}) => api.post(`/datasets/${id}/items/bulk-approve`, body)

// Dataset File Upload
export const uploadDatasetFile = (file) => {
  const form = new FormData()
  form.append('file', file)
  return api.post('/datasets/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } })
}
export const getDatasetFileUrl = (fileRef) => `${api.defaults.baseURL}/datasets/files/${fileRef}`
export const getFileExtractedText = (fileRef) => api.get(`/datasets/files/${fileRef}/text`)
export const addDatasetItemWithFiles = (datasetId, formData) =>
  api.post(`/datasets/${datasetId}/items/upload`, formData, { headers: { 'Content-Type': 'multipart/form-data' } })

// Assessments & Thumbs Feedback
export const addThumbsFeedback = (data) => api.post('/feedback/thumbs', data)
export const getTraceAssessments = (traceId) => api.get(`/traces/${traceId}/assessments`)

// Labeling Sessions
export const createLabelingSession = (data) => api.post('/labeling-sessions', data)
export const getLabelingSessions = (params) => api.get('/labeling-sessions', { params })
export const getLabelingSession = (id) => api.get(`/labeling-sessions/${id}`)
export const addTracesToLabelingSession = (id, traceIds) => api.post(`/labeling-sessions/${id}/traces`, { trace_ids: traceIds })
export const shareLabelingSession = (id, emails) => api.post(`/labeling-sessions/${id}/share`, { reviewer_emails: emails, frontend_base_url: window.location.origin })
export const getLabelingSessionTraces = (id) => api.get(`/labeling-sessions/${id}/traces`)
export const submitLabelingReview = (sessionId, traceId, data) => api.post(`/labeling-sessions/${sessionId}/traces/${traceId}/review`, data)

// Labeling Schemas
export const getLabelingSchemas = (params) => api.get('/labeling-schemas', { params })
export const createLabelingSchema = (data) => api.post('/labeling-schemas', data)
export const getLabelingSchema = (id) => api.get(`/labeling-schemas/${id}`)

// Export traces to evaluation dataset
export const exportTracesToDataset = (data) => api.post('/datasets/from-traces', data)

// Evaluator test & run
export const testEvaluator = (evaluatorId, data) => api.post(`/evaluators/${evaluatorId}/test`, data)
export const runEvaluatorOnTraces = (evaluatorId, data) => api.post(`/evaluators/${evaluatorId}/run-on-traces`, data)

// Evaluation Run Comparison
export const getEvaluationRunTraces = (runId) => api.get(`/evaluations/runs/${runId}/traces`)
export const compareEvaluationRuns = (runIdA, runIdB) => api.get('/evaluations/compare', { params: { run_id_a: runIdA, run_id_b: runIdB } })

// Judge Monitor Config
export const getEvaluatorMonitor = (evaluatorId) => api.get(`/evaluators/${evaluatorId}/monitor`)
export const setEvaluatorMonitor = (evaluatorId, data) => api.put(`/evaluators/${evaluatorId}/monitor`, data)

// Conversation Evaluation
export const runConversationEvaluation = (data) => api.post('/evaluations/run-conversation', data)

// Evaluator Templates & Variables
export const getEvaluatorTemplates = () => api.get('/evaluators/templates')

// Prompt Templates CRUD
export const createPromptTemplate = (data) => api.post('/prompts', data)
export const getPromptTemplates = (params) => api.get('/prompts', { params })
export const getPromptTemplate = (id) => api.get(`/prompts/${id}`)
export const createPromptVersion = (id, data) => api.post(`/prompts/${id}/versions`, data)
export const getPromptTemplateVersions = (id, params) => api.get(`/prompts/${id}/versions`, { params })
export const getPromptVersionDetail = (id, version) => api.get(`/prompts/${id}/versions/${version}`)
export const comparePromptVersions = (id, versionA, versionB) => api.get(`/prompts/${id}/compare`, { params: { version_a: versionA, version_b: versionB } })
export const optimizePrompt = (promptId, data) => api.post(`/prompts/${promptId}/optimize`, data, { timeout: 300000 })
export const getOptimizationRun = (runId) => api.get(`/prompts/optimization-runs/${runId}`)
export const testPromptOnDataset = (promptId, data) => api.post(`/prompts/${promptId}/test-on-dataset`, data, { timeout: 300000 })
export const updatePromptTemplate = (id, data) => api.patch(`/prompts/${id}`, data)
export const deletePromptTemplate = (id) => api.delete(`/prompts/${id}`)
export const updatePromptVersion = (id, version, data) => api.patch(`/prompts/${id}/versions/${version}`, data)
export const deletePromptVersion = (id, version) => api.delete(`/prompts/${id}/versions/${version}`)
export const runEvaluatorOnAllTraces = (evaluatorId, data) => api.post(`/evaluators/${evaluatorId}/run-on-all-traces`, data)

export const sendAgentReport = (serviceName, data) => api.post(`/agents/${encodeURIComponent(serviceName)}/send-report`, data)
export const sendAlertEmail = (alertId) => api.post(`/alerts/${alertId}/send-email`)

// SME Trace Review
export const sendTraceForReview = (traceId, data) => api.post(`/traces/${traceId}/send-review`, data)
export const getTraceReview = (token) => api.get(`/trace-reviews/${token}`)
export const submitTraceReviewComment = (token, data) => api.post(`/trace-reviews/${token}/comments`, data)
export const listTraceReviews = (traceId) => api.get(`/traces/${traceId}/reviews`)

// ── Score Configs ──────────────────────────────────────────────────
export const getScoreConfigs = (params) => api.get('/score-configs', { params })
export const createScoreConfig = (data) => api.post('/score-configs', data)
export const getScoreConfig = (id) => api.get(`/score-configs/${id}`)
export const updateScoreConfig = (id, data) => api.put(`/score-configs/${id}`, data)
export const deleteScoreConfig = (id) => api.delete(`/score-configs/${id}`)

// ── Scores (unified) ──────────────────────────────────────────────
export const addTraceScores = (traceId, data) => api.post(`/traces/${traceId}/scores`, data)
export const getTraceScores = (traceId, params) => api.get(`/traces/${traceId}/scores`, { params })
export const listScores = (params) => api.get('/scores', { params })

// ── Annotation Queues ─────────────────────────────────────────────
export const getAnnotationQueues = (params) => api.get('/annotation-queues', { params })
export const createAnnotationQueue = (data) => api.post('/annotation-queues', data)
export const getAnnotationQueue = (id) => api.get(`/annotation-queues/${id}`)
export const updateAnnotationQueue = (id, data) => api.put(`/annotation-queues/${id}`, data)
export const deleteAnnotationQueue = (id) => api.delete(`/annotation-queues/${id}`)
export const addAnnotationQueueItems = (id, data) => api.post(`/annotation-queues/${id}/items`, data)
export const annotateQueueItem = (queueId, itemId, data) => api.post(`/annotation-queues/${queueId}/items/${itemId}/annotate`, data)
export const approveQueueItems = (queueId, data) => api.post(`/annotation-queues/${queueId}/approve`, data)

// ── Dataset Versioning & Splits ───────────────────────────────────
export const createDatasetVersion = (datasetId, data) => api.post(`/datasets/${datasetId}/versions`, data)
export const getDatasetVersions = (datasetId) => api.get(`/datasets/${datasetId}/versions`)
export const restoreDatasetVersion = (datasetId, versionId) => api.post(`/datasets/${datasetId}/versions/${versionId}/restore`)
export const splitDataset = (datasetId, data) => api.post(`/datasets/${datasetId}/split`, data)
export const createDatasetFromFeedback = (data) => api.post('/datasets/from-feedback', data)

// ── Experiments ───────────────────────────────────────────────────
export const createExperiment = (data) => api.post('/experiments', data, { timeout: 300000 })
export const getExperiments = (params) => api.get('/experiments', { params })
export const getExperiment = (id) => api.get(`/experiments/${id}`)
export const compareExperiments = (ids) => api.get('/experiments/compare', { params: { experiment_ids: ids } })
export const exportExperiment = (id, format = 'json') => api.get(`/experiments/${id}/export`, { params: { format } })

// ── Evaluation Suites ─────────────────────────────────────────────
export const getEvaluationSuites = (params) => api.get('/evaluation-suites', { params })
export const createEvaluationSuite = (data) => api.post('/evaluation-suites', data)
export const getEvaluationSuite = (id) => api.get(`/evaluation-suites/${id}`)
export const updateEvaluationSuite = (id, data) => api.put(`/evaluation-suites/${id}`, data)
export const deleteEvaluationSuite = (id) => api.delete(`/evaluation-suites/${id}`)

// ── Prompt Deployments (A/B Testing) ──────────────────────────────
export const createPromptDeployment = (promptId, data) => api.post(`/prompts/${promptId}/deploy`, data)
export const getPromptDeployment = (promptId) => api.get(`/prompts/${promptId}/deployment`)
export const updatePromptDeployment = (promptId, deploymentId, data) => api.put(`/prompts/${promptId}/deployment/${deploymentId}`, data)
export const resolvePrompt = (promptId) => api.get(`/prompts/${promptId}/resolve`)
export const getDeploymentResults = (promptId) => api.get(`/prompts/${promptId}/deployment/results`)

// ── CI/CD Evaluation ──────────────────────────────────────────────
export const runCiEvaluation = (data) => api.post('/evaluations/ci-run', data, { timeout: 300000 })

// ── Evaluation Results Export ─────────────────────────────────────
export const exportEvaluationRun = (runId, format = 'json') => {
  if (format === 'csv') {
    return api.get(`/evaluations/runs/${runId}/export`, { params: { format }, responseType: 'blob' })
  }
  return api.get(`/evaluations/runs/${runId}/export`, { params: { format } })
}

// ── Scheduled Evaluations ─────────────────────────────────────────
export const getScheduledEvaluations = (params) => api.get('/scheduled-evaluations', { params })
export const createScheduledEvaluation = (data) => api.post('/scheduled-evaluations', data)
export const getScheduledEvaluation = (id) => api.get(`/scheduled-evaluations/${id}`)
export const updateScheduledEvaluation = (id, data) => api.put(`/scheduled-evaluations/${id}`, data)
export const deleteScheduledEvaluation = (id) => api.delete(`/scheduled-evaluations/${id}`)

// ── Trace Summary (SME-friendly) ─────────────────────────────────
export const getTraceSummary = (traceId) => api.get(`/traces/${traceId}/summary`)
