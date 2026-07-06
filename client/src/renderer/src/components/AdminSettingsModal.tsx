import { useCallback, useEffect, useState } from "react";
import type { AdminSettings } from "@intra-chat/shared";
import { fetchAdminSettings, fetchOllamaModels, fetchRagStats, saveAdminSettings, syncRagFolder } from "../api";
import { AdminUsersTab } from "./AdminUsersTab";

interface Props {
  currentUserId: number;
  onClose: () => void;
  onSaved?: () => void | Promise<void>;
}

type Tab = "ai" | "yona" | "jenkins" | "users";

const PLACEHOLDER_TOKEN = "••••••••";

export function AdminSettingsModal({ currentUserId, onClose, onSaved }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>("ai");
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetchAdminSettings()
      .then((s) => setSettings(s))
      .catch(() => setError("설정을 불러오지 못했습니다."))
      .finally(() => setLoading(false));
  }, []);

  function set(key: keyof AdminSettings, value: string | number | boolean): void {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  }

  async function handleSave(): Promise<void> {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      await saveAdminSettings(settings);
      await onSaved?.();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-modal-header">
          <h2>⚙️ 관리자 연동 설정</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="settings-tabs">
          <button className={tab === "ai" ? "active" : ""} onClick={() => setTab("ai")}>
            🤖 AI (Ollama)
          </button>
          <button className={tab === "yona" ? "active" : ""} onClick={() => setTab("yona")}>
            📋 Yona
          </button>
          <button className={tab === "jenkins" ? "active" : ""} onClick={() => setTab("jenkins")}>
            🔧 Jenkins
          </button>
          <button className={tab === "users" ? "active" : ""} onClick={() => setTab("users")}>
            👤 사용자
          </button>
        </div>

        {loading && <div className="settings-loading">설정 불러오는 중...</div>}

        {!loading && settings && (
          <div className="settings-body">
            {tab === "ai" && (
              <AiTab settings={settings} onChange={set} />
            )}
            {tab === "yona" && (
              <YonaTab settings={settings} onChange={set} />
            )}
            {tab === "jenkins" && (
              <JenkinsTab settings={settings} onChange={set} />
            )}
            {tab === "users" && <AdminUsersTab currentUserId={currentUserId} />}
          </div>
        )}

        {error && <div className="login-error">{error}</div>}
        {saved && <div className="settings-saved">✓ 저장되었습니다. 다음 요청부터 즉시 반영됩니다.</div>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose}>닫기</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || loading}>
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className="field">
      <span>
        {label}
        {hint && <span className="field-hint"> — {hint}</span>}
      </span>
      {children}
    </label>
  );
}

function AiTab({
  settings,
  onChange,
}: {
  settings: AdminSettings;
  onChange: (k: keyof AdminSettings, v: string | number | boolean) => void;
}): JSX.Element {
  const [models, setModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [ragStats, setRagStats] = useState<Awaited<ReturnType<typeof fetchRagStats>> | null>(null);
  const [ragSyncing, setRagSyncing] = useState(false);
  const [ragSyncMessage, setRagSyncMessage] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    const url = settings.ollama_url.trim();
    if (!url) {
      setModels([]);
      setLoadedUrl(null);
      setModelsError("Ollama URL을 입력해 주세요.");
      return;
    }

    setModelsLoading(true);
    setModelsError(null);
    try {
      const res = await fetchOllamaModels(url);
      setModels(res.models);
      setLoadedUrl(url);
      if (res.models.length === 0) {
        setModelsError("연결은 되었지만 설치된 모델이 없습니다.");
      }
    } catch (err) {
      setModels([]);
      setLoadedUrl(null);
      setModelsError(err instanceof Error ? err.message : "모델 목록을 불러오지 못했습니다.");
    } finally {
      setModelsLoading(false);
    }
  }, [settings.ollama_url]);

  useEffect(() => {
    if (settings.ollama_url.trim()) {
      void loadModels();
    }
    void fetchRagStats()
      .then(setRagStats)
      .catch(() => undefined);
  }, []);

  async function handleSyncFolder(): Promise<void> {
    setRagSyncing(true);
    setRagSyncMessage(null);
    try {
      const result = await syncRagFolder();
      const [stats] = await Promise.all([fetchRagStats()]);
      setRagStats(stats);
      const errorPart = result.errors.length > 0 ? ` (오류 ${result.errors.length}건)` : "";
      setRagSyncMessage(
        `동기화 완료: 전체 ${result.filesProcessed}개 중 갱신 ${result.filesUpdated}개, 건너뜀 ${result.filesSkipped}개, 조각 ${result.chunksIndexed}개 저장, ${result.chunksRemoved}개 삭제${errorPart}`
      );
    } catch (err) {
      setRagSyncMessage(err instanceof Error ? err.message : "동기화에 실패했습니다.");
    } finally {
      setRagSyncing(false);
    }
  }

  const urlChanged = loadedUrl !== null && loadedUrl !== settings.ollama_url.trim();
  const savedModelMissing =
    settings.ollama_model.trim().length > 0 &&
    models.length > 0 &&
    !models.includes(settings.ollama_model);

  return (
    <>
      <p className="settings-desc">
        인트라넷 내 <b>Ollama</b> 서버 주소를 입력하면 AI 채팅이 활성화됩니다.
        비워두면 AI 기능이 비활성화됩니다.
      </p>
      <Field label="Ollama URL" hint="예: http://192.168.1.10:11434">
        <div className="ollama-url-row">
          <input
            value={settings.ollama_url}
            onChange={(e) => onChange("ollama_url", e.target.value)}
            placeholder="http://localhost:11434"
          />
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void loadModels()}
            disabled={modelsLoading || !settings.ollama_url.trim()}
          >
            {modelsLoading ? "불러오는 중..." : "모델 목록 불러오기"}
          </button>
        </div>
      </Field>

      {urlChanged && (
        <div className="settings-hint-warn">URL이 변경되었습니다. 모델 목록을 다시 불러와 주세요.</div>
      )}
      {modelsError && <div className="settings-hint-error">{modelsError}</div>}
      {!modelsError && loadedUrl && models.length > 0 && (
        <div className="settings-hint-ok">
          {loadedUrl} 에서 {models.length}개 모델을 찾았습니다.
        </div>
      )}

      <Field label="활성 모델" hint="AI 채팅(/ai)에 사용할 모델">
        {models.length > 0 ? (
          <div className="model-list" role="radiogroup" aria-label="Ollama 모델 선택">
            {models.map((model) => (
              <label
                key={model}
                className={`model-option ${settings.ollama_model === model ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="ollama_model"
                  value={model}
                  checked={settings.ollama_model === model}
                  onChange={() => onChange("ollama_model", model)}
                />
                <span>{model}</span>
              </label>
            ))}
          </div>
        ) : (
          <input
            value={settings.ollama_model}
            onChange={(e) => onChange("ollama_model", e.target.value)}
            placeholder="모델 목록을 불러온 뒤 선택하거나 직접 입력"
            disabled={!settings.ollama_url.trim()}
          />
        )}
      </Field>

      {savedModelMissing && (
        <div className="settings-hint-warn">
          현재 저장된 모델({settings.ollama_model})이 목록에 없습니다. 다른 모델을 선택해 주세요.
        </div>
      )}

      <div className="settings-section-title">AI 동작 설정</div>
      <p className="settings-desc">
        AI가 어떻게 답변할지 지정합니다. 저장 후 다음 <code>/ai</code> 요청부터 적용됩니다.
      </p>

      <Field label="응답 언어">
        <select
          value={settings.ai_reply_language}
          onChange={(e) => onChange("ai_reply_language", e.target.value)}
        >
          <option value="ko">한국어로 답변</option>
          <option value="en">English</option>
          <option value="auto">질문과 같은 언어</option>
        </select>
      </Field>

      <Field
        label="추가 지시사항"
        hint="예: 코드는 주석 없이, 표로 정리해 줘, 사내 용어를 사용해 줘"
      >
        <textarea
          className="field-textarea"
          value={settings.ai_extra_instructions}
          onChange={(e) => onChange("ai_extra_instructions", e.target.value)}
          placeholder="한국어로 답변해라. 전문 용어는 쉽게 풀어서 설명해 줘."
          rows={4}
          maxLength={2000}
        />
      </Field>

      <label className="field-checkbox">
        <input
          type="checkbox"
          checked={settings.ai_show_reasoning}
          onChange={(e) => onChange("ai_show_reasoning", e.target.checked)}
        />
        <span>
          <b>AI 추론하기</b>
          <span className="field-hint">
            {" "}— thinking 모델(qwen3.5 등)의 추론 과정을 함께 표시합니다. 끄면 최종 답변만 출력합니다.
          </span>
        </span>
      </label>

      <div className="settings-section-title">RAG 지식 베이스</div>
      <p className="settings-desc">
        AI Q&A 자동 학습과 지정 폴더의 문서를 검색해 답변에 활용합니다. 임베딩 모델은 Ollama에 설치되어 있어야 합니다.
      </p>

      <label className="field-checkbox">
        <input
          type="checkbox"
          checked={settings.rag_enabled}
          onChange={(e) => onChange("rag_enabled", e.target.checked)}
        />
        <span><b>RAG 사용</b><span className="field-hint"> — 지식 베이스 검색을 AI 답변에 반영</span></span>
      </label>

      <label className="field-checkbox">
        <input
          type="checkbox"
          checked={settings.rag_auto_learn}
          onChange={(e) => onChange("rag_auto_learn", e.target.checked)}
          disabled={!settings.rag_enabled}
        />
        <span><b>Q&A 자동 학습</b><span className="field-hint"> — /ai 질문·답변을 지식 베이스에 저장</span></span>
      </label>

      <Field label="임베딩 모델" hint="예: nomic-embed-text">
        <input
          value={settings.rag_embedding_model}
          onChange={(e) => onChange("rag_embedding_model", e.target.value)}
          placeholder="nomic-embed-text"
          disabled={!settings.rag_enabled}
        />
      </Field>

      <Field label="검색 조각 수 (top-K)" hint="질문마다 참고할 지식 조각 수">
        <input
          type="number"
          value={settings.rag_top_k}
          onChange={(e) => onChange("rag_top_k", Number(e.target.value))}
          min={1}
          max={20}
          disabled={!settings.rag_enabled}
        />
      </Field>

      <Field label="문서 폴더" hint="서버 실행 폴더 내 RAG (변경 불가). 10분마다 변경된 파일만 자동 동기화">
        <input
          value={settings.rag_shared_folder || "./RAG"}
          readOnly
          disabled
          className="input-readonly"
        />
        <button
          type="button"
          className="btn-secondary rag-sync-btn"
          onClick={() => void handleSyncFolder()}
          disabled={ragSyncing || !settings.rag_enabled}
        >
          {ragSyncing ? "동기화 중..." : "지금 동기화"}
        </button>
      </Field>

      <p className="settings-desc">
        지원 형식: <code>.txt</code>, <code>.md</code>, <code>.markdown</code>, <code>.memo</code>
        <br />
        서버 실행 폴더의 <code>RAG</code> 를 10분마다 확인해 변경·추가된 문서만 자동 동기화합니다.
        <br />
        AI 업로드 → <code>RAG/ai-uploads</code>, 채널 대화 → <code>RAG/conversations</code> 에 자동 기록됩니다.
        {ragStats && (
          <>
            <br />
            현재 지식: 총 {ragStats.totalChunks}개 (Q&A {ragStats.qaChunks} / 문서 {ragStats.documentChunks})
            {ragStats.lastSyncAt && (
              <>
                <br />
                마지막 동기화: {new Date(ragStats.lastSyncAt).toLocaleString()}
              </>
            )}
          </>
        )}
      </p>
      {ragSyncMessage && (
        <div className={ragSyncMessage.startsWith("동기화 완료") ? "settings-hint-ok" : "settings-hint-error"}>
          {ragSyncMessage}
        </div>
      )}

      <Field label="타임아웃 (ms)" hint="응답 대기 시간 (기본 60000)">
        <input
          type="number"
          value={settings.ollama_timeout_ms}
          onChange={(e) => onChange("ollama_timeout_ms", Number(e.target.value))}
          min={5000}
          step={1000}
        />
      </Field>
      <Field label="컨텍스트 메시지 수" hint="AI에게 전달할 이전 대화 수 (기본 10)">
        <input
          type="number"
          value={settings.ai_context_limit}
          onChange={(e) => onChange("ai_context_limit", Number(e.target.value))}
          min={1}
          max={50}
        />
      </Field>
    </>
  );
}

function YonaTab({
  settings,
  onChange,
}: {
  settings: AdminSettings;
  onChange: (k: keyof AdminSettings, v: string | number | boolean) => void;
}): JSX.Element {
  return (
    <>
      <p className="settings-desc">
        <b>Yona</b> 이슈 관리 서버 연동 설정입니다. URL을 비워두면 Yona 기능이 비활성화됩니다.
      </p>
      <Field label="Yona URL" hint="예: http://yona.internal">
        <input
          value={settings.yona_url}
          onChange={(e) => onChange("yona_url", e.target.value)}
          placeholder="http://yona.internal"
        />
      </Field>
      <Field label="API 토큰" hint="비워두면 기존 토큰 유지">
        <input
          type="password"
          value={settings.yona_token === PLACEHOLDER_TOKEN ? "" : settings.yona_token}
          onChange={(e) => onChange("yona_token", e.target.value)}
          placeholder={settings.yona_token === PLACEHOLDER_TOKEN ? "현재 토큰이 설정되어 있음 (변경하려면 입력)" : ""}
          autoComplete="new-password"
        />
      </Field>
      <Field label="기본 프로젝트" hint="/issue 조회 시 기본으로 사용할 프로젝트명">
        <input
          value={settings.yona_default_project}
          onChange={(e) => onChange("yona_default_project", e.target.value)}
          placeholder="MyProject"
        />
      </Field>
    </>
  );
}

function JenkinsTab({
  settings,
  onChange,
}: {
  settings: AdminSettings;
  onChange: (k: keyof AdminSettings, v: string | number | boolean) => void;
}): JSX.Element {
  return (
    <>
      <p className="settings-desc">
        <b>Jenkins</b> CI/CD 서버 연동 설정입니다. URL을 비워두면 Jenkins 기능이 비활성화됩니다.
      </p>
      <Field label="Jenkins URL" hint="예: http://jenkins.internal">
        <input
          value={settings.jenkins_url}
          onChange={(e) => onChange("jenkins_url", e.target.value)}
          placeholder="http://jenkins.internal"
        />
      </Field>
      <Field label="사용자명">
        <input
          value={settings.jenkins_user}
          onChange={(e) => onChange("jenkins_user", e.target.value)}
          placeholder="admin"
        />
      </Field>
      <Field label="API 토큰" hint="비워두면 기존 토큰 유지">
        <input
          type="password"
          value={settings.jenkins_token === PLACEHOLDER_TOKEN ? "" : settings.jenkins_token}
          onChange={(e) => onChange("jenkins_token", e.target.value)}
          placeholder={settings.jenkins_token === PLACEHOLDER_TOKEN ? "현재 토큰이 설정되어 있음 (변경하려면 입력)" : ""}
          autoComplete="new-password"
        />
      </Field>
      <p className="settings-desc" style={{ marginTop: 12 }}>
        💡 빌드 완료 알림을 받으려면 Jenkins의 Post-build Action에서 아래 주소로 웹훅을 설정하세요:<br />
        <code>POST http://&lt;서버IP&gt;:3000/api/webhooks/jenkins</code>
      </p>
    </>
  );
}
