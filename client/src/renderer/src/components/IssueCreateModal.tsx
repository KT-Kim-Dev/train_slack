import { useState } from "react";
import { createIssue } from "../api";

interface Props {
  roomId: number;
  onClose: () => void;
}

/** Yona 이슈 생성 폼 (FR-36). 생성 결과 카드는 서버가 방에 게시한다. */
export function IssueCreateModal({ roomId, onClose }: Props): JSX.Element {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [project, setProject] = useState("");
  const [labels, setLabels] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(): Promise<void> {
    setError(null);
    if (!title.trim()) {
      setError("제목을 입력하세요.");
      return;
    }
    setSubmitting(true);
    try {
      await createIssue({
        roomId,
        title: title.trim(),
        description: description.trim() || undefined,
        assignee: assignee.trim() || undefined,
        project: project.trim() || undefined,
        labels: labels
          .split(",")
          .map((l) => l.trim())
          .filter(Boolean),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "이슈 생성에 실패했습니다.");
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>새 이슈 생성 (Yona)</h2>

        <label className="field">
          <span>제목 *</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <label className="field">
          <span>설명</span>
          <textarea
            className="modal-textarea"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
          />
        </label>
        <label className="field">
          <span>담당자</span>
          <input value={assignee} onChange={(e) => setAssignee(e.target.value)} />
        </label>
        <label className="field">
          <span>프로젝트</span>
          <input value={project} onChange={(e) => setProject(e.target.value)} placeholder="비우면 기본 프로젝트" />
        </label>
        <label className="field">
          <span>라벨 (쉼표로 구분)</span>
          <input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="bug, urgent" />
        </label>

        {error && <div className="login-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={submitting}>
            취소
          </button>
          <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? "생성 중..." : "이슈 생성"}
          </button>
        </div>
      </div>
    </div>
  );
}
