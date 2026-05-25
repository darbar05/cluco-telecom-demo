import { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Plus, Radio, ExternalLink, MessageSquare, Wifi, WifiOff, ChevronDown } from 'lucide-react';
import SessionSidebar from './components/SessionSidebar';
import ChatMessage from './components/ChatMessage';
import AgentVersionToggle from './components/AgentVersionToggle';
import {
  sendMessage,
  createSession,
  listSessions,
  getSessionMessages,
  getHealth,
} from './api';

export default function App() {
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [agentVersion, setAgentVersion] = useState('v1');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    checkHealth();
    loadSessions();
    const interval = setInterval(checkHealth, 15000);
    return () => clearInterval(interval);
  }, []);

  const checkHealth = async () => {
    try {
      const res = await getHealth();
      setConnected(true);
      setAgentVersion(res.data.agent_version);
    } catch {
      setConnected(false);
    }
  };

  const loadSessions = async () => {
    try {
      const res = await listSessions();
      setSessions(res.data);
    } catch (e) {
      console.error('Failed to load sessions:', e);
    }
  };

  const handleNewChat = async () => {
    try {
      const res = await createSession();
      const newSession = {
        session_id: res.data.session_id,
        created_at: res.data.created_at,
        message_count: 0,
        title: 'New Chat',
      };
      setSessions(prev => [newSession, ...prev]);
      setActiveSessionId(res.data.session_id);
      setMessages([]);
      inputRef.current?.focus();
    } catch (e) {
      console.error('Failed to create session:', e);
    }
  };

  const handleSelectSession = async (sessionId) => {
    setActiveSessionId(sessionId);
    try {
      const res = await getSessionMessages(sessionId);
      setMessages(res.data);
    } catch (e) {
      console.error('Failed to load messages:', e);
      setMessages([]);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setLoading(true);

    const tempUserMsg = {
      role: 'user',
      content: userMessage,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, tempUserMsg]);

    try {
      const res = await sendMessage(userMessage, activeSessionId);
      const data = res.data;

      if (!activeSessionId) {
        setActiveSessionId(data.session_id);
      }

      const assistantMsg = {
        role: 'assistant',
        content: data.response,
        timestamp: data.timestamp,
        trace_id: data.trace_id,
        category: data.category,
        agent_version: data.agent_version,
      };
      setMessages(prev => [...prev, assistantMsg]);
      loadSessions();
    } catch (e) {
      const detail = e.response?.data?.detail || e.message || '';
      let content = 'Sorry, something went wrong. Please try again.';
      if (typeof detail === 'string') {
        if (detail.includes('insufficient_quota') || detail.includes('429')) {
          content = 'OpenAI API quota exceeded. Add billing credits or update OPENAI_API_KEY on the telecom-backend Render service, then try again.';
        } else if (detail.includes('Connection refused') || detail.includes('ECONNREFUSED')) {
          content = 'Cannot reach Cluco Observability backend. Wait for cluco-obs-backend to wake up (free tier cold start), then try again.';
        } else if (detail.length < 300) {
          content = detail;
        }
      }
      const errorMsg = {
        role: 'assistant',
        content,
        timestamp: new Date().toISOString(),
        error: true,
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const suggestedQueries = [
    "What plans do you offer and their prices?",
    "Can I upgrade my device without increasing my bill?",
    "How do I set up eSIM on my new phone?",
    "Compare iPhone 16 Pro vs Galaxy S25 Ultra",
    "What's my trade-in value for an iPhone 15 Pro?",
    "I'm having trouble connecting to 5G",
  ];

  return (
    <div className="flex h-screen bg-[#0f0f14]">
      {/* Sidebar */}
      <div className={`${sidebarOpen ? 'w-72' : 'w-0'} transition-all duration-300 overflow-hidden border-r border-white/5`}>
        <SessionSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
          onNewChat={handleNewChat}
          agentVersion={agentVersion}
          onVersionChange={setAgentVersion}
        />
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-3 border-b border-white/5 bg-[#12121a]">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="p-2 hover:bg-white/5 rounded-lg transition-colors"
            >
              <MessageSquare size={18} className="text-slate-400" />
            </button>
            <div className="flex items-center gap-2">
              <Radio size={20} className="text-telco-400" />
              <h1 className="text-lg font-semibold text-white">TelcoAssist</h1>
            </div>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${
              agentVersion === 'v2'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
            }`}>
              {agentVersion.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <AgentVersionToggle version={agentVersion} onChange={setAgentVersion} />
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${
              connected
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-red-500/10 text-red-400'
            }`}>
              {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
              {connected ? 'Connected' : 'Disconnected'}
            </div>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-6">
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-telco-500 to-telco-700 flex items-center justify-center mb-6">
                <Radio size={28} className="text-white" />
              </div>
              <h2 className="text-2xl font-semibold text-white mb-2">Welcome to TelcoAssist</h2>
              <p className="text-slate-400 text-center mb-8">
                Your AI-powered telecom support agent. Ask about plans, devices, billing, or technical support.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full">
                {suggestedQueries.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => { setInput(q); inputRef.current?.focus(); }}
                    className="text-left px-4 py-3 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-telco-500/30 transition-all text-sm text-slate-300"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto space-y-1">
              {messages.map((msg, i) => (
                <ChatMessage key={i} message={msg} />
              ))}
              {loading && (
                <div className="flex gap-3 py-4">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-telco-500 to-telco-700 flex items-center justify-center flex-shrink-0">
                    <Radio size={14} className="text-white" />
                  </div>
                  <div className="flex items-center gap-1 pt-2">
                    <div className="w-2 h-2 bg-telco-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-telco-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-telco-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input */}
        <div className="px-4 pb-4">
          <div className="max-w-3xl mx-auto">
            <div className="relative flex items-end gap-2 bg-[#1a1a25] border border-white/10 rounded-2xl px-4 py-3 focus-within:border-telco-500/50 transition-colors">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about plans, devices, billing, or support..."
                className="flex-1 bg-transparent outline-none text-sm text-white placeholder-slate-500 resize-none max-h-32 min-h-[20px]"
                rows={1}
                disabled={loading}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || loading}
                className="p-2 rounded-xl bg-telco-600 hover:bg-telco-500 disabled:opacity-30 disabled:hover:bg-telco-600 transition-colors flex-shrink-0"
              >
                <Send size={16} className="text-white" />
              </button>
            </div>
            <p className="text-xs text-slate-500 text-center mt-2">
              Traces are sent to Cluco Observability for monitoring. Open{' '}
              <a href={import.meta.env.VITE_CLUCO_UI_URL || 'http://localhost:9411'} target="_blank" rel="noopener noreferrer" className="text-telco-400 hover:underline">
                Cluco Dashboard
              </a>{' '}
              to inspect them.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
