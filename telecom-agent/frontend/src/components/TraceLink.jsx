import { ExternalLink } from 'lucide-react';

const CLUCO_UI_URL = import.meta.env.VITE_CLUCO_UI_URL || 'http://localhost:9411';

export default function TraceLink({ traceId }) {
  const url = `${CLUCO_UI_URL}/trace/${traceId}`;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1 text-xs text-telco-400 hover:text-telco-300 transition-colors"
      title="View trace in Cluco Observability"
    >
      <ExternalLink size={11} />
      <span>View Trace</span>
    </a>
  );
}
