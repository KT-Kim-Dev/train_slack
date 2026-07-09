# build/

electron-builder 패키징 및 런타임 아이콘 리소스 폴더입니다.

## 아이콘 (ATEC)

| 파일명 | 용도 | 크기 |
|---|---|---|
| `icon.ico` | Windows 실행파일(exe) 아이콘 | 16~256px 다중 해상도 |
| `icon.png` | 앱 창·Dock 아이콘 | 512×512 |
| `tray-icon.png` | 시스템 트레이 아이콘 | 32×32 |

소스 이미지에서 재생성:

```bash
node scripts/generate-app-icons.mjs [소스이미지경로]
```

> Windows ICO 생성에는 `pip install pillow` 가 필요합니다.
