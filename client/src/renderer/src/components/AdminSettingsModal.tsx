import { useEffect, useState } from "react";
import type { AdminSettings } from "@intra-chat/shared";
import { fetchAdminSettings, saveAdminSettings } from "../api";

interface Props {
  onClose: () => void;
}

type Tab = "ai" | "yona" | "jenkins";

const PLACEHOLDER_TOKEN = "••••••••";

export function AdminSettingsModal({ onClose }: Props): JSX.Element {
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

  function set(key: keyof AdminSettings, value: string | number): void {
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
  }

  async function handleSave(): Promise<void> {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      await saveAdminSettings(settings);
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
  onChange: (k: keyof AdminSettings, v: string | number) => void;
}): JSX.Element {
  return (
    <>
      <p className="settings-desc">
        인트라넷 내 <b>Ollama</b> 서버 주소를 입력하면 AI 채팅이 활성화됩니다.
        비워두면 AI 기능이 비활성화됩니다.
      </p>
      <Field label="Ollama URL" hint="예: http://192.168.1.10:11434">
        <input
          value={settings.ollama_url}
          onChange={(e) => onChange("ollama_url", e.target.value)}
          placeholder="http://localhost:11434"
        />
      </Field>
      <Field label="기본 모델" hint="Ollama에 설치된 모델명">
        <input
          value={settings.ollama_model}
          onChange={(e) => onChange("ollama_model", e.target.value)}
          placeholder="llama3"
        />
      </Field>
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
  onChange: (k: keyof AdminSettings, v: string | number) => void;
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
  onChange: (k: keyof AdminSettings, v: string | number) => void;
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
