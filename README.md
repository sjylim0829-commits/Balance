# ⚖️ 실시간 밸런스 게임 웹 서비스 (Firebase Cloud Firestore)

다수의 참가자가 실시간으로 접속하여 정해진 시간 내에 A vs B 중 하나를 선택하고, 타이머 마감 즉시 **다수파(Majority)**인지 **소수파(Minority)**인지 판정받는 실시간 인터랙티브 웹 애플리케이션입니다.

데이터베이스 및 실시간 통신 엔진으로 **Google Firebase (Cloud Firestore)**를 사용하여, 전 세계 어디서든 모바일/PC로 접속할 수 있습니다.

---

## 🌟 핵심 기능

1. **실시간 밸런스 투표 & 동기화 타이머 (참가자 화면 - `/index.html`)**:
   - 진행자가 출제한 질문과 A vs B 선택지가 실시간 노출
   - 서버/진행자 기준 동기화된 카운트다운 타이머 (10초~30초)
   - 타이머 종료 전까지 자유로운 선택 변경 가능

2. **다수파 / 소수파 판정 시스템 (참가자 화면)**:
   - 타이머 마감 즉시 전체 득표 집계
   - **👑 [다수파 승리]**: 전체 득표율과 함께 축하 애니메이션(꽃가루 효과) 표시
   - **⚡ [소수파의 반란]**: 개성 넘치는 소수파만의 특별한 뱃지 부여
   - **⚖️ [황금 밸런스]**: 50:50 동률 시 무승부 연출

3. **진행자 전용 콘솔 (`/host.html`)**:
   - **게임 컨트롤러**: 질문 프리셋 20종 선택 또는 즉석 커스텀 질문 입력, 타이머 시간 설정, [게임 시작], [조기 마감], [대기 초기화]
   - **실시간 접속 모니터링**: 방에 들어온 참가자 수 및 실시간 투표 완료 여부 태그 표시
   - **접속자 개별 선택 내역 확인**: 마감 후 **참가자 닉네임별 선택한 항목(A or B)과 판정 결과를 테이블/카드로 정확히 표시** (필터: 전체 / A선택자 / B선택자 / 미투표자)
   - **종합 통계 대시보드**: 이번 라운드 득표율 도넛 차트, 라운드별 추이 바 차트(Chart.js), 대중픽(다수파 적중률) 랭킹 순위표
   - **데이터 내보내기**: 엑셀 호환 CSV 파일 즉시 다운로드

---

## 🛠️ 기술 스택 및 구조

- **Frontend**: HTML5, Tailwind CSS, Vanilla JS, Canvas-Confetti, Chart.js
- **Database & Realtime**: **Google Firebase (Cloud Firestore `onSnapshot`)**
- **Local Runner**: Python 3.11 내장 HTTP Server (`run.py`)
- **Hosting**: GitHub Pages, Vercel, Firebase Hosting 등 (별도 서버 호스팅 비용 0원)

---

## 🔥 1. Firebase (balance-efed2) 연동 방법

이 프로젝트는 **`balance-efed2`** 프로젝트에 기본 설정되어 있습니다.

1. [Firebase 콘솔 balance-efed2 웹 앱 설정](https://console.firebase.google.com/project/balance-efed2/settings/general)으로 이동합니다.
2. 하단의 **내 앱**에서 웹 앱(`</>`)의 `firebaseConfig` 스크립트를 확인합니다:
   ```javascript
   const firebaseConfig = {
     apiKey: "AIzaSy...",
     authDomain: "balance-efed2.firebaseapp.com",
     projectId: "balance-efed2",
     storageBucket: "balance-efed2.firebasestorage.app",
     messagingSenderId: "...",
     appId: "1:..."
   };
   ```
3. 웹 브라우저(`http://localhost:8000`) 상단의 **[⚙️ Firebase 설정]** 버튼을 누르고, 복사한 설정 코드를 붙여넣은 뒤 **[⚡ 코드 자동 분석 및 입력]** -> **[저장 및 연결]**을 누르면 즉시 Firestore와 연결됩니다!
4. **Firestore 보안 규칙 배포**:
   - [Firestore Database 규칙(Rules) 탭](https://console.firebase.google.com/project/balance-efed2/firestore/rules)에 들어가서 이 프로젝트의 `firebase/firestore.rules` 내용을 붙여넣고 **[게시(Publish)]**를 누릅니다.

---

## 💻 2. 로컬 실행 및 테스트 방법

컴퓨터에서 바로 실행할 때:

```bash
python run.py
```

- 실행 시 브라우저가 자동으로 열리며, 두 개의 탭으로 분할하여 테스트할 수 있습니다:
  - **진행자 화면**: `http://localhost:8000/host.html`
  - **참가자 화면**: `http://localhost:8000/`
- *(팁: Firebase 키를 아직 넣지 않아도, 동일 브라우저의 서로 다른 탭끼리는 자체 브로드캐스트 엔진을 통해 100% 실시간 동기화 테스트가 가능합니다!)*

---

## 🌐 3. Git 업로드 및 무료 웹 배포 (모바일 접속)

### Step 1: Git 리포지토리에 푸시
```bash
git init
git add .
git commit -m "Initial commit: Real-time Balance Game with Firebase"
git branch -M main
git remote add origin https://github.com/당신의계정명/Balance.git
git push -u origin main
```

### Step 2: GitHub Pages로 1분 무료 배포
1. GitHub 저장소 페이지의 **Settings** 탭 클릭
2. 왼쪽 메뉴에서 **Pages** 클릭
3. **Build and deployment -> Source**를 `Deploy from a branch`로 선택
4. **Branch**를 `main` 브랜치, `/ (root)` 폴더로 지정하고 **[Save]** 클릭
5. 1분 후 제공되는 공개 웹 주소(예: `https://당신의계정명.github.io/Balance/`)가 생성됩니다.
6. 이제 친구들에게 링크를 공유하면 스마트폰으로 누구나 즉시 접속할 수 있습니다!

---

## 📁 디렉토리 구조

```
Balance/
├── index.html                  # [참가자 화면] 닉네임 입장, 타이머 투표, 다수/소수 결과 발표
├── host.html                   # [진행자 콘솔] 라운드 제어, 개별 인원 선택 명단, 통계 차트
├── run.py                      # 로컬 원클릭 서버 실행 스크립트
├── .gitignore                  # Git 형상관리 제외 목록
├── README.md                   # 프로젝트 안내 및 배포 가이드
├── css/
│   └── style.css               # 다크 테마, A/B 대비 컬러, 네온 글로우 애니메이션
├── js/
│   ├── config.js               # Firebase 연결 설정 및 환경 관리
│   ├── default_data.js         # 밸런스 게임 기본 질문 프리셋 10선
│   ├── participant.js          # 참가자 Firestore 실시간 동기화 & 투표 로직
│   └── host.js                 # 진행자 Firestore 실시간 제어, 개별 명단 필터링, 통계 차트
└── firebase/
    ├── firestore.rules         # Cloud Firestore 보안 규칙
    └── initial_questions.json  # 밸런스 질문 프리셋 20종 JSON 데이터
```
