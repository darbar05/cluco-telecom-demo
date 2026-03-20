import { Play, Pause, SkipForward, SkipBack, RotateCcw } from 'lucide-react'
import { formatLabel } from './AgentFlowGraph'

const SPEEDS = [0.5, 1, 2, 4]

export default function PlaybackControls({
  timeline,
  currentIndex,
  isPlaying,
  speed,
  onPlay,
  onPause,
  onStepForward,
  onStepBack,
  onReset,
  onSpeedChange,
  onSeek,
}) {
  const total = timeline.length
  const hasStarted = currentIndex >= 0 && total > 0
  const current = hasStarted ? timeline[currentIndex] : null
  const progress = hasStarted ? ((currentIndex + 1) / total) * 100 : 0

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-3">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <button
            onClick={onReset}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
            title="Reset"
          >
            <RotateCcw size={16} />
          </button>
          <button
            onClick={onStepBack}
            disabled={currentIndex <= 0}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Previous agent"
          >
            <SkipBack size={16} />
          </button>
          <button
            onClick={isPlaying ? onPause : onPlay}
            className="p-2 rounded-lg bg-brand-600 text-white hover:bg-brand-700 transition-colors shadow-sm"
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button
            onClick={onStepForward}
            disabled={currentIndex >= total - 1}
            className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Next agent"
          >
            <SkipForward size={16} />
          </button>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-slate-500">
              {hasStarted ? `${currentIndex + 1} / ${total}` : `${total} steps`}
            </span>
            {current ? (
              <span className="text-xs font-semibold text-brand-700 truncate">
                {formatLabel(current.agentId)}
              </span>
            ) : (
              <span className="text-xs text-slate-400">Press play to start</span>
            )}
          </div>
          <div
            className="relative w-full h-2 bg-slate-100 rounded-full cursor-pointer group"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect()
              const pct = (e.clientX - rect.left) / rect.width
              const idx = Math.round(pct * (total - 1))
              onSeek(Math.max(0, Math.min(total - 1, idx)))
            }}
          >
            <div
              className="absolute top-0 left-0 h-full bg-brand-500 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
            {timeline.map((step, i) => {
              const left = total > 1 ? (i / (total - 1)) * 100 : 50
              return (
                <div
                  key={i}
                  className={`absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 transition-all cursor-pointer
                    ${hasStarted && i === currentIndex
                      ? 'bg-brand-600 border-white shadow-md scale-125 z-10'
                      : hasStarted && i < currentIndex
                        ? 'bg-brand-400 border-brand-200'
                        : 'bg-slate-300 border-slate-200'
                    }`}
                  style={{ left: `${left}%`, marginLeft: -5 }}
                  onClick={(e) => { e.stopPropagation(); onSeek(i) }}
                  title={formatLabel(step.agentId)}
                />
              )
            })}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {SPEEDS.map(s => (
            <button
              key={s}
              onClick={() => onSpeedChange(s)}
              className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                speed === s
                  ? 'bg-brand-100 text-brand-700 ring-1 ring-brand-300'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
