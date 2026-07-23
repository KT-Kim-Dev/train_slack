export interface QuickLinkItem {
  title: string;
  url: string;
}

/** 사이드바 링크 메뉴 — 클릭 시 기본 브라우저에서 연다 */
export const QUICK_LINKS: QuickLinkItem[] = [
  { title: "화이트보드", url: "http://192.168.155.89:3333" },
  { title: "프로그램 이력 관리", url: "http://192.168.155.89:8888" },
  { title: "지불장비 거래 분석", url: "http://192.168.155.89:8001" },
];
