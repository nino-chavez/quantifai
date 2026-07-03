import { useState, useRef, useEffect, useCallback } from 'react';

/**
 * ArchaeologyChat — fixed-bottom-right drawer trigger that opens a chat surface
 * over the archaeology substrate. Streams answers via SSE from /derive/stream
 * and renders [E:event_id] citation markers as inline SourceBadge chips that
 * open a secondary drawer with the underlying event detail.
 *
 * Mounted as a global React island in `apps/portal/src/layouts/Layout.astro`.
 * `pageContext` is the current portal page path (e.g. "/inspect/gates"),
 * passed through so the synthesis prompt can scope answers when retrieval
 * supports it.
 */

// REPLACE_FOR_PROJECT: set to your deployed archaeology Worker URL.
// When empty the component renders a disabled "substrate not configured" button.
// Typed as `string` (not the empty-string literal) so the `if (!WORKER_URL)`
// guard below narrows to a normal `string` in the active branch rather than
// collapsing the rest of the component to `never` when the default is blank.
const WORKER_URL: string = '';

interface RankedEvent {
  score: number;
  chunk_id: string;
  event_id: string;
  source: string;
  type: string;
  source_id: string;
  source_ts: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  ranked?: RankedEvent[];
  citations?: string[]; // event_ids extracted from [E:...] markers
  streaming?: boolean;
  error?: string;
}

interface EventDetail {
  event_id: string;
  source: string;
  source_id: string;
  source_ts: string;
  type: string;
  actor?: string;
  payload_json: string;
}

export interface ArchaeologyChatProps {
  pageContext: string;
  /**
   * Empty-state prompt suggestions, supplied at build time from
   * portalConfig().archaeology.suggestions by the mounting layout. When empty,
   * the component falls back to generic, project-neutral prompts.
   */
  suggestions?: string[];
}

export function ArchaeologyChat({ pageContext, suggestions = [] }: ArchaeologyChatProps) {
  if (!WORKER_URL) {
    return (
      <button
        type="button"
        disabled
        className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-contrast-200 px-4 py-3 text-sm font-semibold text-contrast-400 shadow-lg cursor-not-allowed"
        title="Substrate not yet configured — set WORKER_URL in ArchaeologyChat.tsx"
        aria-label="Substrate not configured"
      >
        <span aria-hidden>💬</span>
        <span>Substrate not configured</span>
      </button>
    );
  }


  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [activeEvent, setActiveEvent] = useState<EventDetail | null>(null);
  const [loadingEvent, setLoadingEvent] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  // Restore transcript from localStorage on first mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem('archaeology-chat:transcript');
      if (raw) {
        const parsed = JSON.parse(raw) as ChatMessage[];
        setMessages(parsed);
      }
    } catch {}
  }, []);

  // Persist transcript on every change
  useEffect(() => {
    try {
      localStorage.setItem('archaeology-chat:transcript', JSON.stringify(messages.slice(-30)));
    } catch {}
  }, [messages]);

  // Auto-scroll
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const fetchEvent = useCallback(async (eventId: string) => {
    setLoadingEvent(eventId);
    setActiveEvent(null);
    try {
      // The timeline endpoint joins on source+source_id. We don't know the source
      // upfront from just an event_id, but the ranked list in the latest assistant
      // message carries it. Check the most recent message for a match first.
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      const ranked = lastAssistant?.ranked?.find((r) => r.event_id === eventId);
      if (ranked) {
        const subj = `${ranked.source}:${ranked.source_id}`;
        const res = await fetch(`${WORKER_URL}/timeline?subject=${encodeURIComponent(subj)}`);
        const data = await res.json();
        const ev = (data.direct_events as EventDetail[])?.find((e) => e.event_id === eventId)
          ?? (data.referencing_events as EventDetail[])?.find((e) => e.event_id === eventId);
        if (ev) {
          setActiveEvent(ev);
          return;
        }
      }
      // Fallback — synthesize a minimal record from what we know
      if (ranked) {
        setActiveEvent({
          event_id: ranked.event_id,
          source: ranked.source,
          source_id: ranked.source_id,
          source_ts: ranked.source_ts,
          type: ranked.type,
          payload_json: '{"note":"detail fetch returned no match; showing ranked metadata only"}',
        });
      }
    } catch (err) {
      setActiveEvent({
        event_id: eventId,
        source: '?',
        source_id: '?',
        source_ts: '?',
        type: '?',
        payload_json: JSON.stringify({ error: (err as Error).message }),
      });
    } finally {
      setLoadingEvent(null);
    }
  }, [messages]);

  const send = useCallback(async () => {
    const question = input.trim();
    if (!question || sending) return;
    setSending(true);
    setInput('');

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: question,
    };
    const assistantId = `a-${Date.now()}`;
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      text: '',
      streaming: true,
      ranked: [],
      citations: [],
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    try {
      const url = `${WORKER_URL}/derive/stream?question=${encodeURIComponent(question)}&context=${encodeURIComponent(pageContext)}`;
      const es = new EventSource(url);

      let answerText = '';
      let rankedEvents: RankedEvent[] = [];

      es.addEventListener('retrieval', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          rankedEvents = data.ranked ?? [];
          setMessages((prev) => prev.map((m) => m.id === assistantId ? { ...m, ranked: rankedEvents } : m));
        } catch {}
      });

      es.addEventListener('token', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          answerText += data.text ?? '';
          // Extract citations as we go
          const citations = Array.from(new Set(
            [...answerText.matchAll(/\[E:([0-9A-Z]+)\]/g)].map((m) => m[1])
          ));
          setMessages((prev) => prev.map((m) =>
            m.id === assistantId ? { ...m, text: answerText, citations } : m
          ));
        } catch {}
      });

      es.addEventListener('error', (ev: MessageEvent) => {
        let errText = 'connection error';
        try {
          const data = JSON.parse((ev as any).data ?? '{}');
          errText = data.message ?? data.body ?? errText;
        } catch {}
        setMessages((prev) => prev.map((m) =>
          m.id === assistantId ? { ...m, streaming: false, error: errText } : m
        ));
        es.close();
        setSending(false);
      });

      es.addEventListener('done', () => {
        setMessages((prev) => prev.map((m) =>
          m.id === assistantId ? { ...m, streaming: false } : m
        ));
        es.close();
        setSending(false);
      });

      es.addEventListener('note', (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          setMessages((prev) => prev.map((m) =>
            m.id === assistantId ? { ...m, text: m.text + `\n_${data.message}_` } : m
          ));
        } catch {}
      });

      // EventSource doesn't fire 'error' with body data; catch network-level errors
      es.onerror = () => {
        // If we've never received a 'done' or terminal event, mark as errored
        setMessages((prev) => prev.map((m) =>
          m.id === assistantId && m.streaming ? { ...m, streaming: false, error: m.text ? undefined : 'connection closed' } : m
        ));
        es.close();
        setSending(false);
      };
    } catch (err) {
      setMessages((prev) => prev.map((m) =>
        m.id === assistantId ? { ...m, streaming: false, error: (err as Error).message } : m
      ));
      setSending(false);
    }
  }, [input, pageContext, sending]);

  const clearTranscript = useCallback(() => {
    setMessages([]);
    try { localStorage.removeItem('archaeology-chat:transcript'); } catch {}
  }, []);

  return (
    <>
      {/* Trigger button — fixed bottom-right */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-brand px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:bg-brand/90 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2"
          aria-label="Open archaeology chat"
        >
          <span aria-hidden>💬</span>
          <span>Ask the substrate</span>
        </button>
      )}

      {/* Chat drawer */}
      {open && (
        <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-contrast-200 bg-background shadow-2xl sm:max-w-lg">
          <header className="flex items-center justify-between border-b border-contrast-200 px-4 py-3">
            <div>
              <h2 className="font-heading text-base font-semibold text-foreground">Ask the substrate</h2>
              <p className="font-mono text-[11px] uppercase tracking-wide text-contrast-500">
                grounded in {pageContext === '/' ? 'all sources' : `context: ${pageContext}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {messages.length > 0 && (
                <button
                  type="button"
                  onClick={clearTranscript}
                  className="rounded px-2 py-1 text-xs text-contrast-500 hover:text-foreground"
                >
                  clear
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded px-2 py-1 text-sm text-contrast-500 hover:text-foreground"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </header>

          <div
            ref={transcriptRef}
            className="flex-1 overflow-y-auto px-4 py-4"
          >
            {messages.length === 0 && (
              <EmptyState pageContext={pageContext} suggestions={suggestions} onSuggest={(q) => setInput(q)} />
            )}
            {messages.map((m) => (
              <MessageView
                key={m.id}
                message={m}
                onCitationClick={fetchEvent}
                citationLoading={loadingEvent}
              />
            ))}
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); send(); }}
            className="border-t border-contrast-200 bg-contrast-50 px-4 py-3"
          >
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Ask a question about this project — citations are grounded in real events."
                rows={2}
                disabled={sending}
                className="flex-1 resize-none rounded-md border border-contrast-300 bg-background px-3 py-2 text-sm text-foreground placeholder:text-contrast-400 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={!input.trim() || sending}
                className="rounded-md bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:bg-brand/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {sending ? '…' : 'Send'}
              </button>
            </div>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-wide text-contrast-500">
              Public surface · rate-limited · responses grounded in {WORKER_URL.replace('https://', '')}
            </p>
          </form>
        </div>
      )}

      {/* Source-detail secondary drawer */}
      {activeEvent && (
        <SourceDrawer
          event={activeEvent}
          onClose={() => setActiveEvent(null)}
        />
      )}
    </>
  );
}

function EmptyState({
  pageContext,
  suggestions,
  onSuggest,
}: {
  pageContext: string;
  suggestions: string[];
  onSuggest: (q: string) => void;
}) {
  const prompts = suggestionsFor(pageContext, suggestions);
  return (
    <div className="space-y-4">
      <p className="text-sm text-contrast-600">
        Ask any question about this project. Answers are grounded in real events from sessions, ADRs, audits, inputs, and iterations — every load-bearing claim is cited with <code className="rounded bg-contrast-100 px-1 py-0.5 font-mono text-xs">[E:…]</code> markers you can click to inspect.
      </p>
      <div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-wide text-contrast-500">try one of these</p>
        <div className="space-y-2">
          {prompts.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onSuggest(s)}
              className="block w-full rounded-md border border-contrast-200 bg-background px-3 py-2 text-left text-sm text-foreground transition hover:border-brand hover:bg-contrast-50"
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Resolve the empty-state prompt suggestions for the current page.
 *
 * Priority: project-supplied `configured` prompts (from
 * portalConfig().archaeology.suggestions) win when present. Otherwise the
 * component falls back to generic, project-neutral defaults — augmented with a
 * page-context-scoped prompt so each verb surface offers a relevant starter
 * without baking in any specific project's narrative.
 */
function suggestionsFor(pageContext: string, configured: string[]): string[] {
  if (configured.length > 0) return configured;

  const baseline = [
    'What decisions shaped this project?',
    'What were the major open questions, and how were they resolved?',
    'Which ADRs are load-bearing for the current design?',
  ];
  if (pageContext.startsWith('/inspect/gates')) {
    return ['What is the gating discipline for this project?', ...baseline];
  }
  if (pageContext.startsWith('/inspect/coverage')) {
    return ['How is spec×implementation coverage derived?', ...baseline];
  }
  if (pageContext.startsWith('/roadmap')) {
    return ['Which epics are in flight right now?', ...baseline];
  }
  if (pageContext.startsWith('/operate')) {
    return ['How do the operational surfaces work?', ...baseline];
  }
  return baseline;
}

function MessageView({
  message,
  onCitationClick,
  citationLoading,
}: {
  message: ChatMessage;
  onCitationClick: (eventId: string) => void;
  citationLoading: string | null;
}) {
  if (message.role === 'user') {
    return (
      <div className="mb-3 flex justify-end">
        <div className="max-w-[85%] rounded-lg bg-brand px-3 py-2 text-sm text-white">
          {message.text}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <div className="text-sm leading-relaxed text-foreground">
        <RenderWithCitations
          text={message.text}
          onCitationClick={onCitationClick}
          citationLoading={citationLoading}
        />
        {message.streaming && <span className="ml-1 inline-block h-3 w-1 animate-pulse bg-brand align-middle" />}
      </div>
      {message.error && (
        <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
          {message.error}
        </p>
      )}
      {!message.streaming && message.ranked && message.ranked.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer font-mono text-[11px] uppercase tracking-wide text-contrast-500 hover:text-foreground">
            retrieved {message.ranked.length} sources
          </summary>
          <ul className="mt-2 space-y-1 font-mono text-[11px] text-contrast-600">
            {message.ranked.slice(0, 8).map((r) => (
              <li key={r.chunk_id}>
                <button
                  type="button"
                  onClick={() => onCitationClick(r.event_id)}
                  className="text-left hover:text-brand"
                >
                  {r.score.toFixed(3)} · {r.source}/{r.type} · {r.source_id.slice(0, 24)}{r.source_id.length > 24 ? '…' : ''}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function RenderWithCitations({
  text,
  onCitationClick,
  citationLoading,
}: {
  text: string;
  onCitationClick: (eventId: string) => void;
  citationLoading: string | null;
}) {
  // Split on [E:EVENTID] markers; render text spans + chip buttons
  const parts: Array<{ kind: 'text'; value: string } | { kind: 'cite'; eventId: string }> = [];
  const re = /\[E:([0-9A-Z]+)\]/g;
  let lastIdx = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIdx) {
      parts.push({ kind: 'text', value: text.slice(lastIdx, match.index) });
    }
    parts.push({ kind: 'cite', eventId: match[1] });
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < text.length) {
    parts.push({ kind: 'text', value: text.slice(lastIdx) });
  }
  // Track citation index for display
  const seen = new Map<string, number>();
  parts.forEach((p) => {
    if (p.kind === 'cite' && !seen.has(p.eventId)) seen.set(p.eventId, seen.size + 1);
  });
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === 'text') {
          return <span key={i}>{p.value}</span>;
        }
        const num = seen.get(p.eventId)!;
        const loading = citationLoading === p.eventId;
        return (
          <button
            key={i}
            type="button"
            onClick={() => onCitationClick(p.eventId)}
            title={`Open source event ${p.eventId}`}
            className={`mx-0.5 inline-flex items-center rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-brand transition hover:bg-brand/20 ${loading ? 'animate-pulse' : ''}`}
          >
            {num}
          </button>
        );
      })}
    </>
  );
}

function SourceDrawer({ event, onClose }: { event: EventDetail; onClose: () => void }) {
  let payload: any = null;
  try { payload = JSON.parse(event.payload_json); } catch {}

  return (
    <div className="fixed inset-y-0 right-[28rem] z-50 flex w-full max-w-md flex-col border-l border-contrast-200 bg-background shadow-2xl sm:right-[32rem] sm:max-w-lg">
      <header className="flex items-center justify-between border-b border-contrast-200 px-4 py-3">
        <div>
          <h3 className="font-heading text-sm font-semibold text-foreground">Source event</h3>
          <p className="font-mono text-[10px] uppercase tracking-wide text-contrast-500">
            {event.source}/{event.type}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-2 py-1 text-sm text-contrast-500 hover:text-foreground"
        >
          ✕
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <dl className="space-y-2 font-mono text-[11px]">
          <Row label="event_id">{event.event_id}</Row>
          <Row label="source_id">{event.source_id}</Row>
          <Row label="source_ts">{event.source_ts}</Row>
          {event.actor && <Row label="actor">{event.actor}</Row>}
        </dl>
        <div className="mt-4">
          <p className="mb-1 font-mono text-[10px] uppercase tracking-wide text-contrast-500">payload</p>
          <pre className="overflow-x-auto rounded bg-contrast-50 p-3 text-[11px] leading-snug text-foreground">
            {payload ? JSON.stringify(payload, null, 2).slice(0, 4000) : event.payload_json.slice(0, 4000)}
          </pre>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-contrast-500">{label}</dt>
      <dd className="break-all text-foreground">{children}</dd>
    </div>
  );
}
