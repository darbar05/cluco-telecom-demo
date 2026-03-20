import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'
import Sidebar from './components/ui/Sidebar'
import TracesPage from './pages/TracesPage'
import TraceDetailPage from './pages/TraceDetailPage'
import AgentFlowPage from './pages/AgentFlowPage'
import DashboardPage from './pages/DashboardPage'
import DashboardBuilderPage from './pages/DashboardBuilderPage'
import CustomDashboardViewPage from './pages/CustomDashboardViewPage'
import AgentsPage from './pages/AgentsPage'
import SessionsPage from './pages/SessionsPage'
import SessionDetailPage from './pages/SessionDetailPage'
import AgentMetricsPage from './pages/AgentMetricsPage'
import LLMCallsPage from './pages/LLMCallsPage'
import CostAnalyticsPage from './pages/CostAnalyticsPage'
import QualityTrendsPage from './pages/QualityTrendsPage'
import PromptRegistryPage from './pages/PromptRegistryPage'
import TraceComparisonPage from './pages/TraceComparisonPage'
import AlertsPage from './pages/AlertsPage'
import AlertConfigPage from './pages/AlertConfigPage'
import LiveMonitorPage from './pages/LiveMonitorPage'
import EvaluationsHubPage from './pages/EvaluationsHubPage'
import RunEvaluationPage from './pages/RunEvaluationPage'
import EvaluationResultsPage from './pages/EvaluationResultsPage'
import DatasetManagerPage from './pages/DatasetManagerPage'
import DatasetDetailPage from './pages/DatasetDetailPage'
import LabelingSessionsPage from './pages/LabelingSessionsPage'
import LabelingReviewPage from './pages/LabelingReviewPage'
import TraceReviewPage from './pages/TraceReviewPage'
import ScoreConfigsPage from './pages/ScoreConfigsPage'
import AnnotationQueuesPage from './pages/AnnotationQueuesPage'
import AnnotationReviewPage from './pages/AnnotationReviewPage'
import ExperimentsPage from './pages/ExperimentsPage'
import ExperimentComparePage from './pages/ExperimentComparePage'
import ExperimentDetailPage from './pages/ExperimentDetailPage'
import EvaluationSuitesPage from './pages/EvaluationSuitesPage'
import ScheduledEvaluationsPage from './pages/ScheduledEvaluationsPage'

const PUBLIC_PREFIXES = ['/trace-review/', '/labeling-review/']

function AppInner() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const location = useLocation()
  const isPublic = PUBLIC_PREFIXES.some(p => location.pathname.startsWith(p))

  if (isPublic) {
    return (
      <Routes>
        <Route path="/trace-review/:token" element={<TraceReviewPage />} />
        <Route path="/labeling-review/:sessionId" element={<LabelingReviewPage />} />
      </Routes>
    )
  }

  return (
    <div className="min-h-screen bg-surface-2">
      <Sidebar collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(c => !c)} />
      <main
        className="min-h-screen transition-all duration-200"
        style={{ marginLeft: sidebarCollapsed ? 60 : 240 }}
      >
        <div className="max-w-[1440px] mx-auto px-6 py-6">
          <ErrorBoundary>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/traces" element={<TracesPage />} />
              <Route path="/agent-flow" element={<AgentFlowPage />} />
              <Route path="/trace/:traceId" element={<TraceDetailPage />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/agents/:serviceName" element={<AgentMetricsPage />} />
              <Route path="/sessions" element={<SessionsPage />} />
              <Route path="/sessions/:sessionId" element={<SessionDetailPage />} />
              <Route path="/llm-calls" element={<LLMCallsPage />} />
              <Route path="/cost-analytics" element={<CostAnalyticsPage />} />
              <Route path="/quality-trends" element={<EvaluationsHubPage />} />
              <Route path="/prompt-registry" element={<PromptRegistryPage />} />
              <Route path="/trace-comparison" element={<TraceComparisonPage />} />
              <Route path="/alerts" element={<AlertsPage />} />
              <Route path="/alert-config" element={<AlertConfigPage />} />
              <Route path="/live-monitor" element={<LiveMonitorPage />} />
              {/* Evaluation Framework */}
              <Route path="/evaluations" element={<EvaluationsHubPage />} />
              <Route path="/evaluations/run" element={<RunEvaluationPage />} />
              <Route path="/evaluations/runs/:runId" element={<EvaluationResultsPage />} />
              <Route path="/evaluations/datasets" element={<DatasetManagerPage />} />
              <Route path="/evaluations/datasets/:datasetId" element={<DatasetDetailPage />} />
              <Route path="/evaluations/suites" element={<EvaluationSuitesPage />} />
              <Route path="/evaluations/scheduled" element={<ScheduledEvaluationsPage />} />
              <Route path="/evaluations/experiments" element={<ExperimentsPage />} />
              <Route path="/evaluations/experiments/compare" element={<ExperimentComparePage />} />
              <Route path="/evaluations/experiments/:experimentId" element={<ExperimentDetailPage />} />
              {/* Annotation & Labeling */}
              <Route path="/score-configs" element={<ScoreConfigsPage />} />
              <Route path="/annotation-queues" element={<AnnotationQueuesPage />} />
              <Route path="/annotation-queues/:queueId" element={<AnnotationReviewPage />} />
              <Route path="/labeling-sessions" element={<LabelingSessionsPage />} />
              <Route path="/labeling-sessions/:sessionId" element={<LabelingReviewPage />} />
              {/* Dashboards */}
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/dashboard/new" element={<DashboardBuilderPage />} />
              <Route path="/dashboard/:id" element={<CustomDashboardViewPage />} />
              <Route path="/dashboard/:id/edit" element={<DashboardBuilderPage />} />
            </Routes>
          </ErrorBoundary>
        </div>
      </main>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  )
}
