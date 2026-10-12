import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtTime, type UserInfo } from "./api";
import { Avatar } from "./components";

interface DmPeer { id: number; username: string; nickname: string; avatar: string }
interface DmThread {
  id: number; updated_at: number; unread: number; peer: DmPeer;
  last: { content: string; created_at: number; mine: boolean } | null;
}
interface DmMessage { id: number; content: string; created_at: number; mine: boolean }

export function DmPage({ user, onUnreadChange }: { user: UserInfo; onUnreadChange?: (n: number) => void }) {
  const [threads, setThreads] = useState<DmThread[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<DmMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [newName, setNewName] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [err, setErr] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<number | null>(null);
  activeRef.current = activeId;

  const loadThreads = useCallback(async () => {
    try {
      const d = await api.get<{ threads: DmThread[] }>("/api/dm/threads");
      setThreads(d.threads);
      const total = d.threads.reduce((s, t) => s + t.unread, 0);
      onUnreadChange?.(total);
    } catch { /* ignore */ }
  }, [onUnreadChange]);

  const loadMessages = useCallback(async (tid: number, silent = false) => {
    try {
      const d = await api.get<{ messages: DmMessage[] }>(`/api/dm/threads/${tid}/messages`);
      if (activeRef.current !== tid) return;
      setMessages(d.messages);
      if (!silent) setTimeout(() => bottomRef.current?.scrollIntoView({ block: "end" }), 50);
      // 读完后刷新列表未读数
      void loadThreads();
    } catch (e) { if (!silent) setErr((e as Error).message); }
  }, [loadThreads]);

  useEffect(() => { void loadThreads(); }, [loadThreads]);
  useEffect(() => {
    if (activeId == null) return;
    void loadMessages(activeId);
    const timer = setInterval(() => void loadMessages(activeId, true), 5000);
    return () => clearInterval(timer);
  }, [activeId, loadMessages]);

  const openThread = (tid: number) => { setActiveId(tid); setErr(""); };

  const startNew = async () => {
    const name = newName.trim();
    if (!name) return;
    setErr("");
    try {
      // 先按用户名查用户（复用公开的用户搜索？这里用管理接口之外的轻量方式：直接尝试建会话需 userId，
      // 为简化，先调一个按用户名查用户的新接口）
      const d = await api.get<{ user: DmPeer }>(`/api/users/by-name/${encodeURIComponent(name)}`);
      const t = await api.post<{ id: number }>(`/api/dm/threads`, { userId: d.user.id });
      setNewName(""); setShowNew(false);
      await loadThreads();
      setActiveId(t.id);
    } catch (e) { setErr((e as Error).message); }
  };

  const send = async () => {
    const content = draft.trim();
    if (!content || activeId == null || sending) return;
    setSending(true); setErr("");
    try {
      await api.post(`/api/dm/threads/${activeId}/messages`, { content });
      setDraft("");
      await loadMessages(activeId);
      setTimeout(() => bottomRef.current?.scrollIntoView({ block: "end" }), 50);
    } catch (e) { setErr((e as Error).message); } finally { setSending(false); }
  };

  const active = threads.find((t) => t.id === activeId);

  return (
    <div className="dm-layout">
      <aside className={`dm-list${activeId != null ? " dm-list-hidden" : ""}`}>
        <div className="dm-list-head">
          <h3>私信</h3>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowNew(!showNew)}>＋ 新私信</button>
        </div>
        {showNew && (
          <div className="dm-new">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="输入对方用户名"
              onKeyDown={(e) => { if (e.key === "Enter") void startNew(); }} />
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void startNew()}>发起</button>
          </div>
        )}
        {err && <p className="err-text">{err}</p>}
        {threads.length === 0 ? (
          <p className="muted dm-empty">暂无私信</p>
        ) : threads.map((t) => (
          <button key={t.id} type="button" className={`dm-thread${t.id === activeId ? " on" : ""}`} onClick={() => openThread(t.id)}>
            <Avatar url={t.peer.avatar} name={t.peer.nickname} size={44} />
            <span className="dm-thread-meta">
              <span className="dm-thread-top">
                <strong>{t.peer.nickname}</strong>
                {t.last && <span className="muted tiny">{fmtTime(t.last.created_at)}</span>}
              </span>
              <span className="dm-thread-preview muted tiny">
                {t.last ? `${t.last.mine ? "我: " : ""}${t.last.content}` : "开始聊天吧"}
              </span>
            </span>
            {t.unread > 0 && <span className="dm-badge">{t.unread > 99 ? "99+" : t.unread}</span>}
          </button>
        ))}
      </aside>
      <section className={`dm-chat${activeId == null ? " dm-chat-hidden" : ""}`}>
        {active ? (
          <>
            <div className="dm-chat-head">
              <button type="button" className="btn btn-ghost btn-sm dm-back" onClick={() => setActiveId(null)}>‹ 返回</button>
              <Avatar url={active.peer.avatar} name={active.peer.nickname} size={32} />
              <strong>{active.peer.nickname}</strong>
              <span className="muted tiny">@{active.peer.username}</span>
            </div>
            <div className="dm-messages">
              {messages.map((m) => (
                <div key={m.id} className={`dm-msg${m.mine ? " mine" : ""}`}>
                  <div className="dm-bubble">{m.content}</div>
                  <div className="muted tiny dm-time">{fmtTime(m.created_at)}</div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            <div className="dm-input">
              <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="输入消息…"
                maxLength={2000} onKeyDown={(e) => { if (e.key === "Enter") void send(); }} />
              <button type="button" className="btn btn-primary btn-sm" disabled={sending || !draft.trim()} onClick={() => void send()}>发送</button>
            </div>
          </>
        ) : (
          <p className="muted dm-empty">选择左侧会话开始聊天</p>
        )}
      </section>
    </div>
  );
}
