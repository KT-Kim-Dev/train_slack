/** 인트라넷 서버 주소. 배포 시 VITE_SERVER_URL 로 서버 IP:포트를 지정한다. */
export const SERVER_URL: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined) ?? "http://localhost:3000";
