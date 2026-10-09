'use client';

import { useChat } from '@ai-sdk/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AbstentionCard, AnswerCard, ErrorCard, UnsupportedCard } from '@/components/chat/answer-card';
import { Composer } from '@/components/chat/composer';
import { EmptyState, type Recent } from '@/components/chat/empty-state';
import { ScopeSheet } from '@/components/chat/scope-sheet';
import { ScopeTabs } from '@/components/chat/scope-tabs';
import { noteId } from '@/components/evidence/margin-note';
import { AppHeader } from '@/components/shell/app-header';
import { Button } from '@/components/ui/button';
import { ABSTAIN_MESSAGE } from '@/lib/evidence-policy';
import { SCOPES, isScopeKey, type ScopeKey } from '@/lib/scopes';
import type { ChatMessage, RetrievalResult } from '@/lib/types';

const RECENT_KEY = 'bidaissistph.recent';
const MAX_RECENT = 8;

type Turn = { id: string; text: string; scope: ScopeKey; searching: boolean; toolError: boolean; result: RetrievalResult | null };

function readTurn(m: ChatMessage, fallbackScope: ScopeKey): Turn {
  let result: RetrievalResult | null = null;
  let searching = false;
  let toolError = false;
  let text = '';
  for (const p of m.parts) {
    if (p.type === 'text') text += p.text;
    else if (p.type === 'tool-retrieveEvidence') {
      if (p.state === 'output-available') result = p.output as RetrievalResult;
      else if (p.state === 'output-error') toolError = true;
      else searching = true;
    }
  }
  const scope = m.metadata?.scope;
  return { id: m.id, text, scope: isScopeKey(scope) ? scope : fallbackScope, searching, toolError, result };
}

function errorMessage(error: Error | undefined): string | undefined {
  if (!error) return undefined;
  try {
    const parsed = JSON.parse(error.message) as { message?: string };
    if (parsed.message) return parsed.message;
  } catch { /* not JSON */ }
  return undefined;
}

const textOf = (m: ChatMessage) => m.parts.map(p => (p.type === 'text' ? p.text : '')).join('');

export function Workspace({ counts, corpusVersion, corpusDate, disclaimer, demoMode }: {
  counts: Record<ScopeKey, number>; corpusVersion: string; corpusDate: string; disclaimer: string;
  demoMode: boolean;
  indexedDocuments?: number;
}) {
  const [scope, setScope] = useState<ScopeKey>('all');
  const [recent, setRecent] = useState<Recent[]>([]);
  const [activeMessage, setActiveMessage] = useState<string | null>(null);
  const [activeCite, setActiveCite] = useState<number | null>(null);
  const [scopeSheet, setScopeSheet] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  const [draft, setDraft] = useState('');
  const follow = useRef(true);

  const { messages, sendMessage, regenerate, stop, setMessages, status, error, clearError } = useChat<ChatMessage>();
  const busy = status === 'submitted' || status === 'streaming';

  // "Ask about this notice" arrives as /?scope=…&q=… — the question is placed in the box, never sent
  // automatically, so a link alone cannot make the app ask something on the visitor's behalf.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const s = params.get('scope');
    const q = params.get('q')?.slice(0, 500);
    if (isScopeKey(s)) setScope(s);
    if (q) { setDraft(q); setFocusKey(k => k + 1); }
    if (s || q) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as Recent[];
      if (Array.isArray(stored)) setRecent(stored.filter(r => typeof r?.q === 'string' && isScopeKey(r?.scope)).slice(0, MAX_RECENT));
    } catch { /* storage unavailable: the list simply starts empty */ }
  }, []);

  const remember = useCallback((q: string, s: ScopeKey) => {
    setRecent(prev => {
      const next = [{ q, scope: s }, ...prev.filter(r => r.q !== q)].slice(0, MAX_RECENT);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const ask = useCallback((text: string, s: ScopeKey = scope) => {
    if (busy) return;
    clearError();
    setActiveMessage(null);
    setActiveCite(null);
    follow.current = true;
    remember(text, s);
    void sendMessage({ text, metadata: { scope: s, corpusVersion } }, { body: { scope: s } });
  }, [busy, clearError, corpusVersion, remember, scope, sendMessage]);

  const newQuestion = useCallback(() => {
    void stop();
    clearError();
    setMessages([]);
    setActiveMessage(null);
    setActiveCite(null);
    setFocusKey(k => k + 1);
    window.scrollTo({ top: 0 });
  }, [clearError, setMessages, stop]);

  const clearRecent = useCallback(() => {
    setRecent([]);
    try { localStorage.removeItem(RECENT_KEY); } catch { /* ignore */ }
  }, []);

  const pickRecent = useCallback((r: Recent) => {
    if (busy) return;
    setScope(r.scope);
    ask(r.q, r.scope);
  }, [ask, busy]);

  const retry = useCallback(() => {
    clearError();
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    const s = lastUser?.metadata?.scope;
    void regenerate({ body: { scope: isScopeKey(s) ? s : scope } });
  }, [clearError, messages, regenerate, scope]);

  const turns = useMemo(() => new Map(messages.filter(m => m.role === 'assistant').map(m => [m.id, readTurn(m, scope)])), [messages, scope]);
  const waiting = busy && messages.at(-1)?.role === 'user';

  const selectCite = useCallback((messageId: string, n: number) => {
    setActiveMessage(messageId);
    setActiveCite(n);
    follow.current = false;
    requestAnimationFrame(() => document.getElementById(noteId(messageId, n))?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }, []);

  // Follow the answer as it is written, unless the reader has scrolled away to read something.
  useEffect(() => {
    const onScroll = () => { follow.current = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160; };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    if (follow.current && messages.length) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [messages, status]);

  const started = messages.length > 0;

  return (
    <div className="flex min-h-dvh flex-col">
      <AppHeader active="research" />
      {demoMode && (
        <p role="status" className="border-b border-line bg-status-superseded-bg px-4 py-2 text-center text-[13.5px] text-status-superseded-fg md:px-8">
          <strong className="font-semibold">Demonstration.</strong> No language model is connected. Answers are passages quoted from
          the documents, not written explanations.
        </p>
      )}

      <div className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col md:px-8">
        <main className="flex flex-1 flex-col border-line bg-surface px-4 md:border-x md:px-12">
          <div className="border-b border-line py-4">
            <div className="hidden min-w-0 md:block"><ScopeTabs scope={scope} counts={counts} onChange={setScope} /></div>
            <button type="button" onClick={() => setScopeSheet(true)} aria-haspopup="dialog"
              className="min-h-11 text-left text-[14.5px] text-ink-2 md:hidden">
              Search in <span className="font-semibold text-ink underline decoration-line-strong underline-offset-4">{SCOPES[scope].label}</span>
            </button>
          </div>

          <div id="conversation" role="tabpanel" aria-labelledby={`scope-tab-${scope}`} className="flex-1">
            {!started ? (
              <EmptyState scope={scope} corpusDate={corpusDate} recent={recent} onAsk={q => ask(q)} onPick={pickRecent} onClear={clearRecent}>
                <Composer onAsk={q => ask(q)} busy={busy} onStop={() => void stop()} focusKey={focusKey} draft={draft} />
              </EmptyState>
            ) : (
              <div className="pb-10 pt-8">
                {messages.map((m, i) => {
                  if (m.role === 'user') {
                    const s = m.metadata?.scope;
                    return (
                      <header key={m.id} className={i > 0 ? 'mt-10 border-t border-line pt-10' : ''}>
                        <div className="pb-6">
                          <h2 className="max-w-[28ch] whitespace-pre-wrap font-display text-[26px] font-medium leading-[1.2] tracking-[-0.005em] text-ink md:text-[32px]">
                            <span className="sr-only">You asked: </span>{textOf(m)}
                          </h2>
                          {isScopeKey(s) && s !== 'all' && <p className="mt-2 text-[13.5px] text-muted">Searched in {SCOPES[s].label}</p>}
                        </div>
                      </header>
                    );
                  }
                  const t = turns.get(m.id);
                  if (!t) return null;
                  const isLast = i === messages.length - 1;
                  const streaming = isLast && busy;
                  const question = messages.slice(0, i).reverse().find(x => x.role === 'user');

                  if (t.toolError) return <ErrorCard key={m.id} onRetry={retry} />;
                  // Documents were found, but nothing the model wrote could be verified against them.
                  if (!streaming && t.result && !t.result.abstain && m.metadata?.guard && m.metadata.guard.shown === 0)
                    return <UnsupportedCard key={m.id} removed={m.metadata.guard.removed} evidence={t.result.evidence} messageId={m.id} />;
                  if (t.result?.abstain || (!streaming && t.result && t.text.trim().startsWith(ABSTAIN_MESSAGE) && t.text.trim().length < ABSTAIN_MESSAGE.length + 160))
                    return <AbstentionCard key={m.id} scopeIsAll={t.scope === 'all'} onTryAll={() => { setScope('all'); if (question) ask(textOf(question), 'all'); }} />;
                  if (t.result && (t.text || streaming))
                    return (
                      <AnswerCard key={m.id} messageId={m.id} text={t.text} evidence={t.result.evidence} streaming={streaming}
                        citations={m.metadata?.citations} guard={m.metadata?.guard} corpusDate={corpusDate} flags={t.result.flags}
                        activeCite={activeMessage === m.id ? activeCite : null} onCite={(n: number) => selectCite(m.id, n)} />
                    );
                  if (streaming) return <p key={m.id} className="text-[14.5px] text-muted" role="status">Searching the documents.</p>;
                  // Finished without a search or without text: an unchecked answer is never shown.
                  return isLast && error ? null : <ErrorCard key={m.id} onRetry={retry} />;
                })}
                {waiting && <p className="text-[14.5px] text-muted" role="status">Searching the documents.</p>}
                {error && !busy && <ErrorCard message={errorMessage(error)} onRetry={retry} />}
              </div>
            )}
          </div>

          {started && (
            <div className="sticky bottom-0 -mx-4 border-t border-line bg-surface px-4 pb-3 pt-4 md:-mx-12 md:px-12">
              <div className="flex items-end gap-6">
                <div className="min-w-0 max-w-[760px] flex-1">
                  <Composer onAsk={q => ask(q)} busy={busy} onStop={() => void stop()} focusKey={focusKey} draft={draft} placeholder="Ask a follow-up" />
                </div>
                <span className="ml-auto hidden shrink-0 md:block"><Button variant="ghost" size="lg" onClick={newQuestion}>Start a new question</Button></span>
              </div>
              <p className="mt-2 max-w-[760px] text-[12.5px] leading-snug text-muted">
                <button type="button" onClick={newQuestion} className="mr-2 font-semibold text-accent underline decoration-accent/30 underline-offset-2 md:hidden">Start a new question</button>
                {disclaimer}
              </p>
            </div>
          )}
          {!started && <p className="border-t border-line py-4 text-[12.5px] leading-snug text-muted">{disclaimer}</p>}
        </main>
      </div>

      <ScopeSheet open={scopeSheet} scope={scope} counts={counts} onChange={setScope} onClose={() => setScopeSheet(false)} />
    </div>
  );
}
