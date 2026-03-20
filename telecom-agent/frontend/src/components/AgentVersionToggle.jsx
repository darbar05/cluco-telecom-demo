import { setAgentVersion } from '../api';

export default function AgentVersionToggle({ version, onChange }) {
  const handleToggle = async (newVersion) => {
    if (newVersion === version) return;
    try {
      await setAgentVersion(newVersion);
      onChange(newVersion);
    } catch (e) {
      console.error('Failed to switch version:', e);
    }
  };

  return (
    <div className="flex items-center bg-white/5 rounded-lg p-0.5">
      <button
        onClick={() => handleToggle('v1')}
        className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
          version === 'v1'
            ? 'bg-amber-500/20 text-amber-300 shadow-sm'
            : 'text-slate-400 hover:text-slate-300'
        }`}
      >
        V1
      </button>
      <button
        onClick={() => handleToggle('v2')}
        className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
          version === 'v2'
            ? 'bg-emerald-500/20 text-emerald-300 shadow-sm'
            : 'text-slate-400 hover:text-slate-300'
        }`}
      >
        V2
      </button>
    </div>
  );
}
