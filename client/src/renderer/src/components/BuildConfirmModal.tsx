import { useState } from "react";
import { startBuild } from "../api";

interface Props {
  project: string;
  roomId: number;
  onClose: () => void;
}

/**
 * Jenkins 빌드 실행 확인 모달 (FR-44).
 * 실수로 인한 잘못된 배포를 막기 위해 실행 전 사용자의 명시적 확인을 받는다.
 */
export function BuildConfirmModal({ project, roomId, onClose }: Props): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  async function handleConfirm(): Promise<void> {
    setError(null);
    setRunning(true);
    try {
      await startBuild(project, roomId);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "빌드 실행에 실패했습니다.");
      setRunning(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>빌드 실행 확인</h2>
        <p className="confirm-text">
          <b>{project}</b> 프로젝트의 빌드를 실행하시겠습니까?
          <br />
          <span className="confirm-warn">⚠️ 잘못된 실행은 오배포로 이어질 수 있습니다.</span>
        </p>

        {error && <div className="login-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn-secondary" onClick={onClose} disabled={running}>
            아니오
          </button>
          <button className="btn-primary" onClick={handleConfirm} disabled={running}>
            {running ? "실행 요청 중..." : "예, 빌드 실행"}
          </button>
        </div>
      </div>
    </div>
  );
}
