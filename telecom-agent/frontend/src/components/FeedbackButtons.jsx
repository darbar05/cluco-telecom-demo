import { useState } from 'react';
import { ThumbsUp, ThumbsDown, Check, Loader2, AlertCircle } from 'lucide-react';
import { submitFeedback } from '../api';

export default function FeedbackButtons({ traceId }) {
  const [submitted, setSubmitted] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(false);

  const handleFeedback = async (score) => {
    if (submitted !== null || submitting || !traceId) return;
    setSubmitting(true);
    setError(false);
    try {
      await submitFeedback(traceId, score);
      setSubmitted(score);
    } catch (e) {
      console.error('Failed to submit feedback:', e);
      setError(true);
      setTimeout(() => setError(false), 3000);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted !== null) {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs">
        <Check size={12} className="text-emerald-400" />
        <span className={submitted === 1 ? 'text-emerald-400' : 'text-red-400'}>
          {submitted === 1 ? 'Liked' : 'Flagged'}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="inline-flex items-center gap-1.5 text-xs text-red-400">
        <AlertCircle size={12} />
        <span>Failed</span>
      </div>
    );
  }

  return (
    <div className="inline-flex items-center gap-0.5">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); handleFeedback(1); }}
        disabled={submitting}
        className="p-1.5 rounded-md hover:bg-emerald-500/15 active:bg-emerald-500/25 transition-colors disabled:opacity-50"
        title="Good response"
      >
        {submitting ? (
          <Loader2 size={14} className="text-slate-400 animate-spin" />
        ) : (
          <ThumbsUp size={14} className="text-slate-400 hover:text-emerald-400 transition-colors" />
        )}
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); handleFeedback(0); }}
        disabled={submitting}
        className="p-1.5 rounded-md hover:bg-red-500/15 active:bg-red-500/25 transition-colors disabled:opacity-50"
        title="Bad response"
      >
        <ThumbsDown size={14} className="text-slate-400 hover:text-red-400 transition-colors" />
      </button>
    </div>
  );
}
