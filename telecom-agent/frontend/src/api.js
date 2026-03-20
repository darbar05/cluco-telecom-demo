import axios from 'axios';

const CHAT_API = axios.create({
  baseURL: import.meta.env.VITE_CHAT_API_URL || 'http://localhost:9412',
  timeout: 120000,
});

const CLUCO_API = axios.create({
  baseURL: (import.meta.env.VITE_CLUCO_API_URL || 'http://localhost:9410') + '/api/v1',
  timeout: 30000,
});

export const sendMessage = (message, sessionId) =>
  CHAT_API.post('/chat', { message, session_id: sessionId });

export const createSession = () =>
  CHAT_API.post('/sessions');

export const listSessions = () =>
  CHAT_API.get('/sessions');

export const getSessionMessages = (sessionId) =>
  CHAT_API.get(`/sessions/${sessionId}/messages`);

export const getAgentVersion = () =>
  CHAT_API.get('/agent/version');

export const setAgentVersion = (version) =>
  CHAT_API.post('/agent/version', { version });

export const getHealth = () =>
  CHAT_API.get('/health');

export const submitFeedback = async (traceId, score, comment = '') => {
  const thumbs = score === 1 ? 'up' : 'down';
  const errors = [];

  // Try 1: Telecom backend /feedback endpoint (routes via SDK)
  try {
    const res = await CHAT_API.post('/feedback', {
      trace_id: traceId,
      thumbs,
      comment: comment || undefined,
    });
    return res;
  } catch (e) {
    errors.push(`telecom-backend: ${e.message}`);
  }

  // Try 2: Cluco backend /feedback/thumbs endpoint (direct)
  try {
    const res = await CLUCO_API.post('/feedback/thumbs', {
      trace_id: traceId,
      thumbs,
      comment: comment || undefined,
      source: 'user',
    });
    return res;
  } catch (e) {
    errors.push(`cluco-backend: ${e.message}`);
  }

  throw new Error(`All feedback endpoints failed: ${errors.join('; ')}`);
};
