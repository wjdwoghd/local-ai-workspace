import { useEffect, useRef, useState } from "react";
import type { ThemePreference } from "../../../../packages/shared-types/ipc/desktop";
import { createConversation, demoReply } from "./features/chat/demo";

const themes: {
  value: ThemePreference;
  label: string;
  icon: string;
  description: string;
}[] = [
  {
    value: "light",
    label: "라이트",
    icon: "☀",
    description: "밝고 선명한 화면",
  },
  {
    value: "dark",
    label: "다크",
    icon: "☾",
    description: "눈이 편안한 어두운 화면",
  },
  {
    value: "system",
    label: "시스템",
    icon: "◐",
    description: "기기 설정에 맞춰 자동 전환",
  },
];

export default function App() {
  const [conversations, setConversations] = useState(() => [
    createConversation(),
  ]);
  const [activeId, setActiveId] = useState(conversations[0].id);
  const [page, setPage] = useState<"chat" | "settings">("chat");
  const [draft, setDraft] = useState("");
  const [theme, setTheme] = useState<ThemePreference>("system");
  const [version, setVersion] = useState("");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const current = conversations.find((item) => item.id === activeId)!;

  useEffect(() => {
    window.desktop
      .getInfo()
      .then((info) => {
        setTheme(info.theme);
        setVersion(info.version);
        setReady(true);
      })
      .catch(() =>
        setError("앱 정보를 불러오지 못했습니다. 앱을 다시 실행해 주세요."),
      );
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [current.messages.length, page, activeId]);

  function newChat() {
    const chat = createConversation();
    setConversations((items) => [chat, ...items]);
    setActiveId(chat.id);
    setPage("chat");
    setDraft("");
    requestAnimationFrame(() => input.current?.focus());
  }
  function send(text = draft) {
    text = text.trim();
    if (!text || text.length > 4000) return;
    setConversations((items) =>
      items.map((item) =>
        item.id !== activeId
          ? item
          : {
              ...item,
              title: item.messages.length ? item.title : text.slice(0, 28),
              messages: [
                ...item.messages,
                { id: crypto.randomUUID(), role: "user", text },
                {
                  id: crypto.randomUUID(),
                  role: "assistant",
                  text: demoReply(text),
                },
              ],
            },
      ),
    );
    setDraft("");
    input.current?.focus();
  }
  async function changeTheme(value: ThemePreference) {
    setSaving(true);
    setNotice("");
    setError("");
    try {
      await window.desktop.setTheme(value);
      setTheme(value);
      setNotice("테마 설정을 저장했습니다.");
    } catch {
      setError("테마를 저장하지 못했습니다. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        본문으로 건너뛰기
      </a>
      <aside className="sidebar" aria-label="사이드바">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ✳
          </span>
          <div>
            Local AI<span>WORKSPACE</span>
          </div>
        </div>
        <button className="new-chat" onClick={newChat}>
          <span aria-hidden="true">＋</span> 새 대화 <kbd>↵</kbd>
        </button>
        <nav aria-label="주요 메뉴">
          <button
            className={page === "chat" ? "nav-item selected" : "nav-item"}
            aria-current={page === "chat" ? "page" : undefined}
            onClick={() => setPage("chat")}
          >
            <span aria-hidden="true">▤</span> 채팅
          </button>
        </nav>
        <div className="history-label">
          이번 실행의 대화 <span>{conversations.length}</span>
        </div>
        <nav className="history" aria-label="대화 목록">
          {conversations.map((chat) => (
            <button
              key={chat.id}
              className={`history-item ${page === "chat" && chat.id === activeId ? "active" : ""}`}
              aria-current={
                page === "chat" && chat.id === activeId ? "true" : undefined
              }
              onClick={() => {
                setActiveId(chat.id);
                setDraft("");
                setPage("chat");
              }}
            >
              <span aria-hidden="true">◦</span>
              <span>{chat.title}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="local-note">
            <span className="status-dot" /> 로컬 데모 모드
            <p>외부 연결 없이 화면을 체험하세요.</p>
          </div>
          <button
            className={`nav-item ${page === "settings" ? "selected" : ""}`}
            aria-current={page === "settings" ? "page" : undefined}
            onClick={() => {
              setPage("settings");
              setNotice("");
            }}
          >
            <span aria-hidden="true">⚙</span> 설정
          </button>
          <div className="profile">
            <span className="avatar">나</span>
            <div>
              내 워크스페이스<small>이 기기에서 체험 중</small>
            </div>
          </div>
        </div>
      </aside>
      <main id="main" tabIndex={-1}>
        <header className="topbar">
          <div>
            {page === "chat" ? "워크스페이스 / 채팅" : "워크스페이스 / 설정"}
          </div>
          <span className="demo-badge">
            <span className="status-dot" /> DEMO
          </span>
        </header>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        {page === "chat" ? (
          <section className="chat-page" aria-label="채팅 화면">
            <div className="chat-heading">
              <div>
                <h1>
                  {current.messages.length ? current.title : "새로운 대화"}
                </h1>
                <p>생각을 정리하는 나만의 공간</p>
              </div>
              <span className="pill">로컬 데모</span>
            </div>
            <div
              className={`message-scroll ${current.messages.length ? "" : "empty-scroll"}`}
            >
              {current.messages.length === 0 ? (
                <div className="welcome">
                  <div className="welcome-icon" aria-hidden="true">
                    ✳
                  </div>
                  <div className="eyebrow">YOUR SPACE TO THINK</div>
                  <h2>
                    오늘은 어떤 생각을
                    <br />
                    함께 정리해 볼까요?
                  </h2>
                  <p>
                    작은 아이디어부터 하루의 계획까지.
                    <br />
                    아래 예시를 선택하거나 편하게 말을 걸어 보세요.
                  </p>
                  <div className="suggestions">
                    {[
                      {
                        icon: "☀",
                        title: "하루를 가볍게 시작하기",
                        text: "오늘 할 일의 계획을 세워줘",
                      },
                      {
                        icon: "✧",
                        title: "워크스페이스 알아보기",
                        text: "어떤 기능을 사용할 수 있어?",
                      },
                    ].map((item) => (
                      <button key={item.title} onClick={() => send(item.text)}>
                        <span aria-hidden="true">{item.icon}</span>
                        <strong>{item.title}</strong>
                        <small>
                          {item.text} <span aria-hidden="true">↗</span>
                        </small>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div
                  className="messages"
                  role="log"
                  aria-label="메시지"
                  aria-live="polite"
                >
                  {current.messages.map((message) => (
                    <article
                      key={message.id}
                      className={`message ${message.role}`}
                    >
                      <div className="message-avatar" aria-hidden="true">
                        {message.role === "user" ? "나" : "✳"}
                      </div>
                      <div>
                        <div className="message-label">
                          {message.role === "user" ? "나" : "Local AI"}
                          {message.role === "assistant" && (
                            <span>데모 응답</span>
                          )}
                        </div>
                        <p>{message.text}</p>
                      </div>
                    </article>
                  ))}
                  <div ref={end} />
                </div>
              )}
            </div>
            <div className="composer-wrap">
              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  send();
                }}
              >
                <label className="sr-only" htmlFor="message">
                  메시지 입력
                </label>
                <textarea
                  ref={input}
                  id="message"
                  placeholder="메시지를 입력하세요…"
                  value={draft}
                  maxLength={4000}
                  rows={2}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing &&
                      event.keyCode !== 229
                    ) {
                      event.preventDefault();
                      send();
                    }
                  }}
                />
                <div className="composer-footer">
                  <span>
                    데모 대화{" "}
                    <span className="composer-hint">
                      · Shift + Enter로 줄바꿈
                    </span>
                  </span>
                  <button
                    className="send"
                    aria-label="메시지 보내기"
                    disabled={!draft.trim()}
                    type="submit"
                  >
                    ↑
                  </button>
                </div>
              </form>
              <p className="disclaimer">
                실제 AI가 아닌 로컬 데모 응답입니다. 대화는 앱을 닫으면
                사라집니다.
              </p>
            </div>
          </section>
        ) : (
          <section className="settings-page" aria-labelledby="settings-title">
            <div className="eyebrow">PREFERENCES</div>
            <h1 id="settings-title">설정</h1>
            <p className="settings-intro">
              나에게 편안한 워크스페이스를 만들어 보세요.
            </p>
            <section className="settings-card">
              <h2>화면 테마</h2>
              <p>선택한 테마는 이 기기에 저장되며 다음 실행에도 유지됩니다.</p>
              <fieldset disabled={!ready || saving}>
                <legend className="sr-only">화면 테마 선택</legend>
                <div className="theme-options">
                  {themes.map((item) => (
                    <label
                      key={item.value}
                      className={`theme-option ${theme === item.value ? "chosen" : ""}`}
                    >
                      <input
                        type="radio"
                        name="theme"
                        value={item.value}
                        checked={theme === item.value}
                        onChange={() => void changeTheme(item.value)}
                      />
                      <span
                        className={`theme-preview ${item.value}`}
                        aria-hidden="true"
                      >
                        <span>{item.icon}</span>
                        <i />
                        <i />
                      </span>
                      <strong>{item.label}</strong>
                      <small>{item.description}</small>
                    </label>
                  ))}
                </div>
              </fieldset>
              <p className="save-notice" role="status">
                {saving ? "저장 중…" : notice}
              </p>
            </section>
            <section className="settings-card about">
              <span className="brand-mark" aria-hidden="true">
                ✳
              </span>
              <div>
                <h2>Local AI Workspace</h2>
                <p>
                  앱 버전{" "}
                  <span data-testid="app-version">
                    {version || "불러오는 중…"}
                  </span>{" "}
                  · 1단계 UI 데모
                </p>
              </div>
              <span className="pill">로컬 데모</span>
            </section>
            <p className="settings-footnote">
              현재 제공 기능: 데모 채팅, 대화 목록, 테마 설정.
              <br />
              계정 로그인과 실제 AI 연결은 후속 단계에서 제공할 예정입니다.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}
