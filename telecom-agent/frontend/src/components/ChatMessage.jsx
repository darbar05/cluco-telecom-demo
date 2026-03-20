import { useState } from 'react';
import { Radio, User, ExternalLink, AlertCircle } from 'lucide-react';
import FeedbackButtons from './FeedbackButtons';
import TraceLink from './TraceLink';

const CATEGORY_COLORS = {
  billing: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20' },
  products: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  support: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
};

export default function ChatMessage({ message }) {
  const isUser = message.role === 'user';
  const isError = message.error;
  const categoryStyle = CATEGORY_COLORS[message.category] || {};

  if (isUser) {
    return (
      <div className="flex justify-end py-3">
        <div className="flex gap-3 max-w-[80%]">
          <div className="bg-telco-600/20 border border-telco-500/20 rounded-2xl rounded-tr-md px-4 py-3">
            <p className="text-sm text-slate-200 whitespace-pre-wrap">{message.content}</p>
          </div>
          <div className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0">
            <User size={14} className="text-slate-300" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-3 py-3">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
        isError
          ? 'bg-red-500/20'
          : 'bg-gradient-to-br from-telco-500 to-telco-700'
      }`}>
        {isError ? (
          <AlertCircle size={14} className="text-red-400" />
        ) : (
          <Radio size={14} className="text-white" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`rounded-2xl rounded-tl-md px-4 py-3 ${
          isError ? 'bg-red-500/5 border border-red-500/10' : 'bg-white/[0.03]'
        }`}>
          <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">{message.content}</p>
        </div>

        {/* Meta info bar */}
        {!isError && (message.trace_id || message.category) && (
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {message.category && (
              <span className={`px-2 py-0.5 rounded text-xs font-medium border ${categoryStyle.bg} ${categoryStyle.text} ${categoryStyle.border}`}>
                {message.category}
              </span>
            )}
            {message.agent_version && (
              <span className="text-xs text-slate-500">
                {message.agent_version}
              </span>
            )}
            {message.trace_id && (
              <>
                <FeedbackButtons traceId={message.trace_id} />
                <TraceLink traceId={message.trace_id} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
