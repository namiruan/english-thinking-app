# 클라우드 TTS 서버 배포 (Cloudflare Workers AI)

아이폰/아이패드/맥에서 **빠르고 자연스러운 무료 음성**을 쓰기 위한 작은 서버(Worker)예요.
Cloudflare 무료 계정 하나면 됩니다. (하루 10,000 뉴런 무료)

## 1) Cloudflare 무료 계정 만들기

https://dash.cloudflare.com/sign-up — 카드 필요 없어요.

## 2) 배포 (둘 중 편한 방법)

### 방법 A — 명령어 (권장, `worker/` 폴더에서)

```bash
cd worker
npx wrangler login        # 브라우저로 Cloudflare 로그인 (1회)
npx wrangler deploy       # 배포 → https://et-tts.<서브도메인>.workers.dev 주소가 나옴
```

(선택, 남용 방지) 시크릿 설정:

```bash
npx wrangler secret put TTS_SECRET
# 아무 비밀 문자열 입력 (앱 설정에도 같은 값을 넣어야 함)
```

### 방법 B — 대시보드에서 복붙

1. Cloudflare 대시보드 → **Workers & Pages** → **Create** → **Create Worker**
2. 이름 `et-tts` → **Deploy** → **Edit code**
3. `worker.js` 내용을 전부 복사해 붙여넣고 **Deploy**
4. **Settings → Bindings → Add → Workers AI**, 변수명 `AI` 로 추가
5. (선택) **Settings → Variables and Secrets → Add**, 이름 `TTS_SECRET`, 타입 Secret, 값은 아무 비밀 문자열

## 3) 앱에 연결

앱 ⚙ 설정 → **음성 엔진: 클라우드 음성** 선택 →
- **TTS 서버 주소**: 위에서 나온 `https://et-tts.xxx.workers.dev`
- **시크릿**: (설정했다면) 같은 값
- **음성** 고르고 **미리듣기** → 저장

이제 모든 기기에서 즉시·자연스러운 음성이 나옵니다.

## 참고
- 무료 한도(하루 1만 뉴런) 초과 시 다음날 리셋.
- 주소가 공개되므로 시크릿 설정을 권장(다른 사람이 내 한도를 쓰는 것 방지).
