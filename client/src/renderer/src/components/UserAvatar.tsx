import { useEffect, useState } from "react";
import type { PublicUser } from "@intra-chat/shared";
import { avatarUrl } from "../api";

interface Props {
  user: Pick<PublicUser, "id" | "displayName" | "profileImageUrl">;
  size?: number;
  className?: string;
  /** 프로필 변경 시 이미지 갱신용 */
  cacheBust?: string | number;
}

export function UserAvatar({ user, size = 32, className = "", cacheBust }: Props): JSX.Element {
  const [imgError, setImgError] = useState(false);
  const initial = user.displayName.charAt(0).toUpperCase();
  const bust = cacheBust ?? "";
  const showImg = Boolean(user.profileImageUrl) && !imgError;

  useEffect(() => {
    setImgError(false);
  }, [user.profileImageUrl, bust]);

  return (
    <span
      className={`user-avatar ${className}`.trim()}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }}
      title={user.displayName}
    >
      {showImg ? (
        <img
          src={avatarUrl(user.id, user.profileImageUrl, bust || undefined)}
          alt=""
          draggable={false}
          onError={() => setImgError(true)}
        />
      ) : (
        <span className="user-avatar-initial">{initial}</span>
      )}
    </span>
  );
}
