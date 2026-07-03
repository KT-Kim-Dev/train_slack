# build/

이 폴더에는 electron-builder 가 패키징 시 사용하는 리소스를 넣습니다.

## 아이콘

| 파일명 | 용도 | 권장 크기 |
|---|---|---|
| `icon.ico` | Windows 실행파일 아이콘 | 256×256 포함 다중 해상도 ICO |
| `icon.png` | 기타 플랫폼(참고용) | 512×512 PNG |

없으면 기본 Electron 아이콘이 사용됩니다.

### ICO 파일 간단 생성 방법 (ImageMagick)
```bash
convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
```
