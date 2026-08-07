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

## git에 저장 (구문 + 암호화된 API 키)

구문과 API 키를 저장소(`public/vault.json`)에 저장해서 기기 간 동기화·백업할 수 있어요.

- **구문**은 평문으로 저장됩니다 (민감정보 아님).
- **API 키**는 **비밀번호로 암호화(AES-GCM)** 되어 암호문만 저장됩니다. 원본 키는 저장되지 않아요.
  공개 저장소여도 **비밀번호를 모르면 키를 꺼낼 수 없습니다.**

### 잠금 설정 방법 (앱에서 GitHub에 자동 저장)

1. **fine-grained GitHub 토큰 발급** (한 번만):
   - https://github.com/settings/personal-access-tokens/new
   - **Repository access** → *Only select repositories* → `english-thinking-app`
   - **Permissions** → *Repository permissions* → **Contents: Read and write**
   - 생성된 `github_pat_...` 토큰 복사
2. 앱 **⚙ 설정** → **🔐 git에 저장** 섹션
   - **암호화할 API 키** + **비밀번호**(강하게!) 입력
   - **GitHub 토큰** 붙여넣기 (이 브라우저에만 저장됨)
3. **🚀 GitHub에 바로 저장** 클릭 → 앱이 `public/vault.json`을 직접 커밋 → **약 30초 후 라이브 자동 반영**
4. 이제 사이트에 처음 들어오면 **비밀번호 입력창(잠금 해제)** 이 뜨고, 맞게 입력하면 대화가 시작됩니다.

> 토큰 없이 쓰려면 **파일만 만들기** → ⬇ 다운로드 → `public/vault.json`에 덮어쓰고 직접 `git push` 해도 됩니다.

> ⚠️ **비밀번호는 반드시 강하게** (긴 문구 권장). 약한 비밀번호는 공개된 암호문에서 오프라인으로 뚫릴 수 있어요.
> 키가 새더라도 `aistudio.google.com`에서 즉시 폐기·재발급할 수 있습니다.

구문만 바꿨을 때는 설정에서 **"구문만 저장 (기존 잠금 유지)"** 로 기존 암호를 그대로 두고 vault.json을 갱신할 수 있어요.

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
