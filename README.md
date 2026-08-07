# 영어식 사고 — 입에 척 달라붙는 구문 훈련

영어 표현(구문)을 AI와 대화하며 몸에 익히는 학습 웹앱입니다.
Gemini로 대화하고, **Native TTS로 원어민 음성**을 들으며, **브라우저 마이크로 음성 입력**을 합니다.

## 주요 기능

- **표현 등록** — 카테고리별로 영어 구문 + 뜻 + 노트를 등록 (브라우저에 로컬 저장)
- **집중 구문 연습 모드** — 목표 구문 하나를 반복 훈련. AI가 상황을 주면 영어로 답하고, 올바르게 쓰면 `Clean` 카운트 상승
- **자유 실전 대화 모드** — 등록한 구문들을 자연스러운 대화 속에서 활용
- **원어민 음성 (Native TTS)** — AI의 영어 문장을 Gemini Native Audio로 재생, 음성 선택 가능
- **음성 입력** — 브라우저 내장 음성 인식(무료)
- **기록** — 세션별 대화/Clean 통계

## 실행 방법

```bash
npm install
npm run dev
```

브라우저에서 `http://localhost:5173` 접속 → 우측 상단 **⚙ 설정**에서 Gemini API 키 입력.

### Gemini API 키 (무료)

1. https://aistudio.google.com/apikey 접속 (Google 로그인)
2. **Create API key** → 키 복사
3. 앱의 **설정**에 붙여넣기 (브라우저에만 저장, 외부 전송 없음)

무료 티어에는 분당/일당 요청 한도가 있습니다. "사용량 초과" 메시지가 뜨면 잠시 후 다시 시도하세요.

## 빌드

```bash
npm run build      # dist/ 생성
npm run preview    # 빌드 결과 미리보기
```

## 기술 스택

- React 18 + TypeScript + Vite
- `@google/genai` — Gemini 2.5 Flash (대화) / `gemini-2.5-flash-preview-tts` (음성)
- Web Speech API — 음성 입력
- localStorage — 데이터 저장 (서버 없음)

## ⚠️ 보안 참고

이 앱은 브라우저에서 직접 Gemini API를 호출합니다. **개인용/로컬 사용**을 전제로 하며,
공개 사이트로 배포하면 API 키가 노출될 수 있습니다. 공개 배포 시에는 별도의 백엔드 프록시를
두고 키를 서버에서 관리하세요.

## 음성 입력 브라우저 지원

Web Speech API 기반으로, **Chrome / Edge**에서 가장 잘 동작합니다.
