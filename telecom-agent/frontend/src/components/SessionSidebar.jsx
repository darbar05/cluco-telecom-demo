import { Plus, MessageSquare, Radio } from 'lucide-react';

export default function SessionSidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewChat,
}) {
  const formatDate = (dateStr) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now - d;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  };

  return (
    <div className="flex flex-col h-full bg-[#0c0c12]">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-4 border-b border-white/5">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-telco-500 to-telco-700 flex items-center justify-center">
          <Radio size={16} className="text-white" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-white">TelcoAssist</h2>
          <p className="text-[10px] text-slate-500">AI Customer Support</p>
        </div>
      </div>

      {/* New Chat */}
      <div className="px-3 py-3">
        <button
          onClick={onNewChat}
          className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl border border-white/10 hover:border-telco-500/30 hover:bg-telco-500/5 transition-all text-sm text-slate-300"
        >
          <Plus size={16} />
          <span>New Chat</span>
        </button>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider px-2 mb-2">
          Recent Chats
        </p>
        {sessions.length === 0 ? (
          <p className="text-xs text-slate-600 px-2 py-4 text-center">
            No chats yet. Start a new one!
          </p>
        ) : (
          <div className="space-y-0.5">
            {sessions.map((session) => (
              <button
                key={session.session_id}
                onClick={() => onSelectSession(session.session_id)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-all group ${
                  activeSessionId === session.session_id
                    ? 'bg-telco-500/10 border border-telco-500/20'
                    : 'hover:bg-white/[0.03] border border-transparent'
                }`}
              >
                <div className="flex items-center gap-2">
                  <MessageSquare size={13} className={
                    activeSessionId === session.session_id
                      ? 'text-telco-400'
                      : 'text-slate-500'
                  } />
                  <span className="text-sm text-slate-300 truncate flex-1">
                    {session.title || 'New Chat'}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1 pl-5">
                  <span className="text-[10px] text-slate-500">
                    {formatDate(session.created_at)}
                  </span>
                  <span className="text-[10px] text-slate-600">
                    {session.message_count} msgs
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/5">
        <a
          href={import.meta.env.VITE_CLUCO_UI_URL || 'http://localhost:9411'}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-slate-500 hover:text-telco-400 transition-colors"
        >
          <div className="w-5 h-5 rounded bg-purple-500/10 flex items-center justify-center">
            <span className="text-[8px] font-bold text-purple-400">C</span>
          </div>
          Open Cluco Dashboard
        </a>
      </div>
    </div>
  );
}
