/**
 * ChatContext - Manages chat state, messaging, and streaming
 * 
 * This context is a thin wrapper that wires pure operation functions
 * (from @/features/chat/operations/) to React state.
 *
 * Business logic lives in the operations layer; this file handles only:
 * - React state declarations
 * - Ref management for stable callback references
 * - Wiring operations → setState
 * - Subscribing to gateway events
 */
import { createContext, useContext, useCallback, useRef, useEffect, useState, useMemo, type ReactNode } from 'react';
import { useGateway } from './GatewayContext';
import { useSessionContext } from './SessionContext';
import { useSettings } from './SettingsContext';
import type { ChatMsg } from '@/features/chat/types';
import type { GatewayEvent } from '@/types';
import { renderMarkdown, renderToolResults } from '@/utils/helpers';
import { playPing } from '@/features/voice/audio-feedback';
import {
  loadChatHistory,
  splitToolCallMessage,
  buildUserMessage,
  sendChatMessage,
  classifyStreamEvent,
  extractStreamDelta,
  extractFinalMessage,
  buildActivityLogEntry,
  markToolCompleted,
  appendActivityEntry,
  deriveProcessingStage,
  isActiveAgentState,
} from '@/features/chat/operations';
import type { ImageAttachment } from '@/features/chat/types';

// ─── Voice TTS fallback helper ─────────────────────────────────────────────────

const FALLBACK_MAX_CHARS = 300;

/** Strip code blocks, markdown noise, and validate text is speakable for TTS fallback. */
function buildVoiceFallbackText(raw: string): string | null {
  // Strip fenced code blocks
  let text = raw.replace(/```[\s\S]*?```/g, '');
  // Strip inline code
  text = text.replace(/`[^`]+`/g, '');
  // Strip markdown images/links
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, '');
  text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Strip markdown formatting (bold, italic, headers, hr)
  text = text.replace(/#{1,6}\s+/g, '');
  text = text.replace(/[*_~]{1,3}/g, '');
  text = text.replace(/^---+$/gm, '');
  // Collapse whitespace
  text = text.replace(/\n{2,}/g, '. ').replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
  // Must have at least 3 word-like characters to be speakable
  if (!/[a-zA-Z]{3,}/.test(text)) return null;
  // Cap length
  if (text.length > FALLBACK_MAX_CHARS) {
    text = text.slice(0, FALLBACK_MAX_CHARS).replace(/\s\S*$/, '') + '…';
  }
  return text;
}

/** Processing stages for enhanced thinking indicator */
export type ProcessingStage = 'thinking' | 'tool_use' | 'streaming' | null;

/** A single entry in the activity log */
export interface ActivityLogEntry {
  id: string;           // toolCallId or generated unique id
  toolName: string;     // raw tool name (e.g., 'read', 'exec')
  description: string;  // human-friendly from describeToolUse()
  startedAt: number;    // Date.now() when tool started
  completedAt?: number; // Date.now() when result received
  phase: 'running' | 'completed';
}

interface ChatContextValue {
  messages: ChatMsg[];
  isGenerating: boolean;
  streamingHtml: string;
  processingStage: ProcessingStage;
  lastEventTimestamp: number;
  activityLog: ActivityLogEntry[];
  currentToolDescription: string | null;
  handleSend: (text: string, images?: ImageAttachment[]) => Promise<void>;
  handleAbort: () => Promise<void>;
  handleReset: () => void;
  loadHistory: (session?: string) => Promise<void>;
  /** Load more (older) messages — returns true if there are still more to show */
  loadMore: () => boolean;
  /** Whether there are older messages available to load */
  hasMore: boolean;
  /** Reset confirmation dialog state — rendered by the consumer, not the provider */
  showResetConfirm: boolean;
  confirmReset: () => Promise<void>;
  cancelReset: () => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { connectionState, rpc, subscribe } = useGateway();
  const { currentSession } = useSessionContext();
  const { soundEnabled, speak } = useSettings();
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  // Full history buffer + visible window for infinite scroll
  const allMessagesRef = useRef<ChatMsg[]>([]);
  const [visibleCount, setVisibleCount] = useState(50);
  const [hasMore, setHasMore] = useState(false);
  const LOAD_MORE_BATCH = 30;
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingHtml, setStreamingHtml] = useState('');
  const [processingStage, setProcessingStage] = useState<ProcessingStage>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [lastEventTimestamp, setLastEventTimestamp] = useState<number>(0);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);

  const streamBufferRef = useRef('');
  const rafIdRef = useRef<number | null>(null);
  const playedSoundsRef = useRef<Set<string>>(new Set());

  // Voice message tracking for TTS fallback
  const lastMessageWasVoiceRef = useRef(false);

  // Thinking duration tracking (gateway doesn't stream thinking content)
  const thinkingStartRef = useRef<number | null>(null);
  const thinkingDurationRef = useRef<number | null>(null);
  const thinkingRunIdRef = useRef<string | null>(null);

  // Abort controller for in-flight history polls — lets chat_final cancel stale polls
  const pollAbortRef = useRef<AbortController | null>(null);

  // Refs for stable callback references — synced in a single effect
  const currentSessionRef = useRef(currentSession);
  const isGeneratingRef = useRef(isGenerating);
  const soundEnabledRef = useRef(soundEnabled);
  const speakRef = useRef(speak);

  useEffect(() => {
    currentSessionRef.current = currentSession;
    isGeneratingRef.current = isGenerating;
    soundEnabledRef.current = soundEnabled;
    speakRef.current = speak;
  }, [currentSession, isGenerating, soundEnabled, speak]);

  // Derive currentToolDescription from activityLog — no separate state needed
  const currentToolDescription = useMemo(() => {
    const lastRunning = [...activityLog].reverse().find(e => e.phase === 'running');
    return lastRunning ? lastRunning.description : null;
  }, [activityLog]);

  const scheduleStreamingUpdate = useCallback((text: string) => {
    streamBufferRef.current = text;
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      const current = streamBufferRef.current;
      setStreamingHtml(renderToolResults(renderMarkdown(current, { highlight: false })));
    });
  }, []);

  // Cleanup streaming RAF on unmount
  useEffect(() => {
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, []);

  // ─── Load history (delegates to pure function) ───────────────────────────────
  const loadHistory = useCallback(async (session?: string) => {
    const sk = session || currentSessionRef.current;
    try {
      const result = await loadChatHistory({ rpc, sessionKey: sk, limit: 500 });
      allMessagesRef.current = result;
      // Show all if under threshold, otherwise show last N
      if (result.length <= 50) {
        setVisibleCount(result.length);
        setHasMore(false);
        setMessages(result);
      } else {
        setVisibleCount(50);
        setHasMore(true);
        setMessages(result.slice(-50));
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      allMessagesRef.current = [];
      setHasMore(false);
      setMessages(prev => [...prev, {
        role: 'system', html: 'Failed to load history: ' + errMsg, rawText: '', timestamp: new Date(),
      }]);
    }
  }, [rpc]);

  // ─── Load more (older) messages for infinite scroll ──────────────────────────
  const loadMore = useCallback(() => {
    const all = allMessagesRef.current;
    if (all.length <= visibleCount) { setHasMore(false); return false; }
    const newCount = Math.min(all.length, visibleCount + LOAD_MORE_BATCH);
    setVisibleCount(newCount);
    setMessages(all.slice(-newCount));
    const stillMore = newCount < all.length;
    setHasMore(stillMore);
    return stillMore;
  }, [visibleCount]);

  // ─── Reset transient state on session switch ─────────────────────────────────
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- valid: reset transient state on session change */
    setStreamingHtml('');
    setIsGenerating(false);
    setProcessingStage(null);
    setActivityLog([]);
    setLastEventTimestamp(0);
    setVisibleCount(50);
    setHasMore(false);
    allMessagesRef.current = [];
    streamBufferRef.current = '';
    thinkingStartRef.current = null;
    thinkingDurationRef.current = null;
    thinkingRunIdRef.current = null;
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [currentSession]);

  // Load history on connect and session change
  useEffect(() => {
    if (connectionState === 'connected') {
      loadHistory(currentSession); // eslint-disable-line react-hooks/set-state-in-effect -- valid: data fetching on state change
    }
  }, [connectionState, currentSession, loadHistory]);

  // ─── Poll history during active turns for real-time thinking/tool bubbles ────
  useEffect(() => {
    if (!isGenerating) return;
    const inflight = { current: false };
    const timer = setInterval(() => {
      if (inflight.current) return;
      inflight.current = true;
      const ac = new AbortController();
      pollAbortRef.current = ac;
      loadHistory().finally(() => {
        inflight.current = false;
        if (pollAbortRef.current === ac) pollAbortRef.current = null;
      });
    }, 2500);
    return () => {
      clearInterval(timer);
      // Abort any in-flight poll so it doesn't overwrite chat_final data
      pollAbortRef.current?.abort();
      pollAbortRef.current = null;
    };
  }, [isGenerating, loadHistory]);

  // ─── Subscribe to streaming events ───────────────────────────────────────────
  useEffect(() => {
    return subscribe((msg: GatewayEvent) => {
      const classified = classifyStreamEvent(msg);
      if (!classified) return;

      // Ignore events for other sessions
      if (classified.sessionKey !== currentSessionRef.current) return;

      const { type } = classified;

      // ── Agent events ──────────────────────────────────────────────────────
      if (classified.source === 'agent') {
        const ap = classified.agentPayload!;

        if (type === 'lifecycle_start') {
          setIsGenerating(true);
          setProcessingStage('thinking');
          setLastEventTimestamp(Date.now());
          return;
        }

        if (type === 'lifecycle_end') {
          setIsGenerating(false);
          setProcessingStage(null);
          setActivityLog([]);
          setLastEventTimestamp(0);
          if (soundEnabledRef.current) playPing();
          loadHistory().catch(() => {});
          return;
        }

        if (type === 'assistant_stream') {
          setProcessingStage('streaming');
          setLastEventTimestamp(Date.now());
          return;
        }

        // Mid-stream join detection
        const agentState = ap.state || ap.agentState;
        if (!isGeneratingRef.current && agentState && isActiveAgentState(agentState)) {
          setIsGenerating(true);
        }

        setLastEventTimestamp(Date.now());

        if (type === 'agent_tool_start') {
          setProcessingStage('tool_use');
          const entry = buildActivityLogEntry(ap);
          if (entry) {
            setActivityLog(prev => appendActivityEntry(prev, entry));
          }
          return;
        }

        if (type === 'agent_tool_result') {
          const completedId = ap.data?.toolCallId;
          if (completedId) {
            setActivityLog(prev => markToolCompleted(prev, completedId));
          }
          return;
        }

        if (type === 'agent_state' && agentState) {
          const stage = deriveProcessingStage(agentState);
          if (stage) setProcessingStage(stage);
        }
        return;
      }

      // ── Chat events ───────────────────────────────────────────────────────
      const cp = classified.chatPayload!;

      setLastEventTimestamp(Date.now());

      if (type === 'chat_started') {
        playedSoundsRef.current.clear();
        setProcessingStage('thinking');
        setActivityLog([]);
        thinkingStartRef.current = Date.now();
        thinkingDurationRef.current = null;
        thinkingRunIdRef.current = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
        return;
      }

      if (type === 'chat_delta') {
        // Mid-stream join detection
        if (!isGeneratingRef.current) setIsGenerating(true);

        // Capture thinking duration on first delta
        if (thinkingStartRef.current) {
          thinkingDurationRef.current = Date.now() - thinkingStartRef.current;
          thinkingStartRef.current = null;
        }

        const delta = extractStreamDelta(cp);
        if (delta) {
          scheduleStreamingUpdate(delta.cleaned);
          setProcessingStage('streaming');
        }
        return;
      }

      if (type === 'chat_final') {
        const finalData = extractFinalMessage(cp);

        setIsGenerating(false);
        setStreamingHtml('');
        setProcessingStage(null);
        setActivityLog([]);
        setLastEventTimestamp(0);

        // Handle TTS from the final message
        if (finalData) {
          if (finalData.ttsText && !playedSoundsRef.current.has(finalData.ttsText)) {
            playedSoundsRef.current.add(finalData.ttsText);
            speakRef.current(finalData.ttsText);
          } else if (!finalData.ttsText && lastMessageWasVoiceRef.current && finalData.text) {
            // Voice fallback: agent forgot [tts:...] marker — auto-speak cleaned response
            const fallback = buildVoiceFallbackText(finalData.text);
            if (fallback) speakRef.current(fallback);
          } else if (!finalData.ttsText && soundEnabledRef.current) {
            playPing();
          }
        } else {
          if (soundEnabledRef.current) playPing();
        }

        // Abort any in-flight poll to prevent stale data overwriting our final reload
        pollAbortRef.current?.abort();
        pollAbortRef.current = null;

        // Reload full history to sync canonical transcript
        const savedDuration = thinkingDurationRef.current;
        const expectedRunId = thinkingRunIdRef.current;
        loadHistory().then(() => {
          // Guard against async race: skip if a new run started
          if (thinkingRunIdRef.current !== expectedRunId) return;

          // Patch the last thinking bubble from this turn with duration
          if (savedDuration && savedDuration > 0) {
            setMessages(prev => {
              // Scope search to current turn (after last user message)
              const lastUserIdx = prev.reduce((acc, m, i) => m.role === 'user' ? i : acc, -1);
              const searchSlice = lastUserIdx >= 0 ? prev.slice(lastUserIdx) : prev;
              const reverseIdx = [...searchSlice].reverse().findIndex(m => m.role === 'assistant' && m.isThinking);
              if (reverseIdx >= 0) {
                const realIdx = (lastUserIdx >= 0 ? lastUserIdx : 0) + searchSlice.length - 1 - reverseIdx;
                const updated = [...prev];
                updated[realIdx] = { ...updated[realIdx], thinkingDurationMs: savedDuration };
                return updated;
              }
              return prev;
            });
          }
          thinkingDurationRef.current = null;
          thinkingStartRef.current = null;
          thinkingRunIdRef.current = null;
        }).catch(() => {
          if (finalData) {
            const newMessages = splitToolCallMessage(finalData.message);
            setMessages(prev => [...prev, ...newMessages]);
          }
        });
        return;
      }

      if (type === 'chat_error') {
        setIsGenerating(false);
        setStreamingHtml('');
        setProcessingStage(null);
        setActivityLog([]);
        setLastEventTimestamp(0);
        thinkingStartRef.current = null;
        thinkingDurationRef.current = null;
        thinkingRunIdRef.current = null;
        return;
      }
    });
  }, [subscribe, scheduleStreamingUpdate, loadHistory]);

  // ─── Send message (delegates to pure functions) ──────────────────────────────
  const handleSend = useCallback(async (text: string, images?: ImageAttachment[]) => {
    // Track voice messages for TTS fallback
    lastMessageWasVoiceRef.current = text.startsWith('[voice] ');

    const { msg: userMsg, tempId } = buildUserMessage({ text, images });

    // Optimistic insert — sync both full buffer and visible slice
    allMessagesRef.current = [...allMessagesRef.current, userMsg];
    setMessages(prev => [...prev, userMsg]);
    setIsGenerating(true);
    setStreamingHtml('');
    setProcessingStage('thinking');

    const idempotencyKey = crypto.randomUUID ? crypto.randomUUID() : 'ik-' + Date.now();
    try {
      await sendChatMessage({
        rpc,
        sessionKey: currentSessionRef.current,
        text,
        images,
        idempotencyKey,
      });
      // Confirm the message — remove pending state
      setMessages(prev => prev.map(m =>
        m.tempId === tempId ? { ...m, pending: false } : m,
      ));
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      // Mark message as failed
      setMessages(prev => prev.map(m =>
        m.tempId === tempId ? { ...m, pending: false, failed: true } : m,
      ));
      setMessages(prev => [...prev, {
        role: 'system', html: 'Send error: ' + errMsg, rawText: '', timestamp: new Date(),
      }]);
      setIsGenerating(false);
    }
  }, [rpc]);

  // ─── Abort / Reset ──────────────────────────────────────────────────────────
  const handleAbort = useCallback(async () => {
    try {
      await rpc('chat.abort', { sessionKey: currentSessionRef.current });
    } catch (err) {
      console.debug('[ChatContext] Abort request failed:', err);
    }
  }, [rpc]);

  const handleReset = useCallback(() => {
    setShowResetConfirm(true);
  }, []);

  const confirmReset = useCallback(async () => {
    setShowResetConfirm(false);
    try {
      await rpc('sessions.reset', { key: currentSessionRef.current });
      setMessages([{
        role: 'system', html: '⚙️ Session reset. Starting fresh.', rawText: '', timestamp: new Date(),
      }]);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setMessages(prev => [...prev, {
        role: 'system', html: `⚙️ Reset failed: ${errMsg}`, rawText: '', timestamp: new Date(),
      }]);
    }
  }, [rpc]);

  const cancelReset = useCallback(() => {
    setShowResetConfirm(false);
  }, []);

  // ─── Context value ──────────────────────────────────────────────────────────
  const value = useMemo<ChatContextValue>(() => ({
    messages,
    isGenerating,
    streamingHtml,
    processingStage,
    lastEventTimestamp,
    activityLog,
    currentToolDescription,
    handleSend,
    handleAbort,
    handleReset,
    loadHistory,
    loadMore,
    hasMore,
    showResetConfirm,
    confirmReset,
    cancelReset,
  }), [
    messages, isGenerating, streamingHtml, processingStage,
    lastEventTimestamp, activityLog, currentToolDescription,
    handleSend, handleAbort, handleReset, loadHistory,
    loadMore, hasMore,
    showResetConfirm, confirmReset, cancelReset,
  ]);

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- hook export is intentional
export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
