// ============================================================================
// 참가자 클라이언트 로직 (participant.js)
// Google Firebase (Cloud Firestore) + BroadcastChannel 듀얼 동기화 엔진
// ============================================================================

let db = null;
let roomUnsubscribe = null;
let localBroadcast = null;

// 참가자 로컬 상태
const state = {
  nickname: "",
  roomId: "default",
  currentQuestion: null,
  myChoice: null, // 'A' | 'B' | null
  gameStatus: "waiting", // 'waiting' | 'voting' | 'result'
  timerInterval: null,
  duration: 15,
  startedAt: null,
  currentRoundKey: ""
};

// Web Audio API 사운드 합성기
const SoundFx = {
  ctx: null,
  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
  },
  playClick() {
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(600, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.08);
    } catch (e) {}
  },
  playTick() {
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(1000, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + 0.05);
    } catch (e) {}
  },
  playWin() {
    try {
      this.init();
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.frequency.setValueAtTime(freq, now + i * 0.1);
        gain.gain.setValueAtTime(0.25, now + i * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.1 + 0.25);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start(now + i * 0.1);
        osc.stop(now + i * 0.1 + 0.25);
      });
    } catch (e) {}
  }
};

// 페이지 로드 시 초기화
window.addEventListener("DOMContentLoaded", () => {
  const savedNick = localStorage.getItem("balance_user_nickname");
  if (savedNick) document.getElementById("nicknameInput").value = savedNick;

  const savedRoom = localStorage.getItem("balance_room_id");
  if (savedRoom) document.getElementById("roomInput").value = savedRoom;

  db = initFirebase();
  updateConnectionBadge();
});

// 연결 상태 배지 업데이트
function updateConnectionBadge() {
  const badge = document.getElementById("connectionBadge");
  if (!badge) return;
  const cfg = getFirebaseConfig();

  if (db && cfg && cfg.apiKey) {
    badge.className = "px-2.5 py-1 text-xs rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5";
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span>Firebase (${cfg.projectId}) 연결됨</span>`;
  } else {
    badge.className = "px-2.5 py-1 text-xs rounded-full bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center gap-1.5";
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-sky-400"></span><span>${cfg.projectId} (로컬 모드)</span>`;
  }
}

// 닉네임 입력 및 게임 참여
async function handleJoinGame(e) {
  e.preventDefault();
  const nickInput = document.getElementById("nicknameInput").value.trim();
  const roomInput = document.getElementById("roomInput").value.trim() || "default";

  if (!nickInput) {
    alert("닉네임을 입력해 주세요!");
    return;
  }

  state.nickname = nickInput;
  state.roomId = roomInput;
  localStorage.setItem("balance_user_nickname", nickInput);
  localStorage.setItem("balance_room_id", roomInput);

  document.getElementById("displayNickname").textContent = nickInput;
  const roomDisplay = document.getElementById("displayRoomName");
  if (roomDisplay) roomDisplay.textContent = roomInput;

  switchScreen("waiting");

  setupRealtimeListeners();
}

// 실시간 동기화 설정 (Firebase Firestore + Local BroadcastChannel)
function setupRealtimeListeners() {
  const channelName = `balance_room_${state.roomId}`;

  // 1. Local BroadcastChannel (동일 기기 탭 간 즉시 동기화)
  if (window.BroadcastChannel) {
    if (localBroadcast) localBroadcast.close();
    localBroadcast = new BroadcastChannel(channelName);
    localBroadcast.onmessage = (event) => {
      handleIncomingGameEvent(event.data);
    };
    localBroadcast.postMessage({
      type: "JOIN",
      nickname: state.nickname,
      timestamp: Date.now()
    });
  }

  // 2. Firebase Cloud Firestore onSnapshot 리스너
  db = initFirebase();
  if (db) {
    // 이전 리스너 해제
    if (roomUnsubscribe) roomUnsubscribe();

    const roomRef = db.collection("rooms").doc(state.roomId);

    // 방 상태 실시간 감지
    roomUnsubscribe = roomRef.onSnapshot((doc) => {
      if (!doc.exists) return;
      const roomData = doc.data();
      handleRoomStateFromFirestore(roomData);
    }, (err) => {
      console.warn("Firestore 실시간 리스너 경고:", err);
    });

    // 참가자 등록 (문서 생성/업데이트)
    roomRef.collection("participants").doc(state.nickname).set({
      nickname: state.nickname,
      lastActive: Date.now()
    }, { merge: true }).catch((err) => console.warn("참가자 등록 경고:", err));
  }
}

// Firestore 방 상태 변경 핸들러
function handleRoomStateFromFirestore(roomData) {
  if (!roomData || !roomData.status) return;

  if (roomData.status === "voting") {
    const roundKey = `${roomData.startedAt}_${roomData.currentQuestion ? roomData.currentQuestion.id : ""}`;
    if (state.currentRoundKey !== roundKey) {
      state.currentRoundKey = roundKey;
      onRoundStarted({
        question: roomData.currentQuestion,
        duration: roomData.duration || 15,
        startedAt: roomData.startedAt || Date.now()
      });
    }
  } else if (roomData.status === "result") {
    if (roomData.resultSummary && state.gameStatus !== "result") {
      onResultsReceived(roomData.resultSummary);
    }
  } else if (roomData.status === "waiting") {
    if (state.gameStatus !== "waiting") {
      onRoundReset();
    }
  }
}

// 로컬 BroadcastChannel 이벤트 수신 핸들러
function handleIncomingGameEvent(data) {
  if (!data || !data.event) return;

  switch (data.event) {
    case "START_ROUND":
      onRoundStarted(data.payload);
      break;
    case "SHOW_RESULTS":
      onResultsReceived(data.payload);
      break;
    case "RESET_ROUND":
      onRoundReset();
      break;
  }
}

// 라운드 시작 이벤트 수신 시
function onRoundStarted(payload) {
  state.gameStatus = "voting";
  state.currentQuestion = payload.question;
  state.duration = payload.duration || 15;
  state.startedAt = payload.startedAt || Date.now();
  state.myChoice = null;

  document.getElementById("questionTitle").textContent = payload.question.title;
  document.getElementById("questionCategory").textContent = payload.question.category || "밸런스 질문";
  document.getElementById("textOptionA").textContent = payload.question.optionA;
  document.getElementById("textOptionB").textContent = payload.question.optionB;

  resetChoiceCards();
  switchScreen("voting");
  startCountdown();
}

// 카운트다운 타이머
function startCountdown() {
  if (state.timerInterval) clearInterval(state.timerInterval);

  const timerText = document.getElementById("timerText");
  const timerBar = document.getElementById("timerProgressBar");

  const tick = () => {
    const elapsed = Math.floor((Date.now() - state.startedAt) / 1000);
    const remaining = Math.max(0, state.duration - elapsed);

    timerText.textContent = `${remaining}s`;
    const percent = Math.max(0, (remaining / state.duration) * 100);
    timerBar.style.width = `${percent}%`;

    if (remaining <= 5 && remaining > 0) {
      timerText.classList.add("timer-pulse");
      SoundFx.playTick();
    } else {
      timerText.classList.remove("timer-pulse");
    }

    if (remaining <= 0) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
      document.getElementById("cardOptionA").style.pointerEvents = "none";
      document.getElementById("cardOptionB").style.pointerEvents = "none";
    }
  };

  tick();
  state.timerInterval = setInterval(tick, 200);
}

// 선택지 클릭 (A or B)
function handleSelectOption(option) {
  if (state.gameStatus !== "voting") return;

  state.myChoice = option;
  SoundFx.playClick();

  const cardA = document.getElementById("cardOptionA");
  const cardB = document.getElementById("cardOptionB");
  const checkA = document.getElementById("checkA");
  const checkB = document.getElementById("checkB");

  if (option === "A") {
    cardA.classList.add("selected");
    checkA.classList.remove("hidden");
    cardB.classList.remove("selected");
    checkB.classList.add("hidden");
  } else {
    cardB.classList.add("selected");
    checkB.classList.remove("hidden");
    cardA.classList.remove("selected");
    checkA.classList.add("hidden");
  }

  sendVote(option);
}

// 투표 데이터 전송 (Firestore 및 Local Broadcast)
async function sendVote(option) {
  const voteData = {
    nickname: state.nickname,
    option: option,
    questionId: state.currentQuestion ? state.currentQuestion.id : "unknown",
    questionTitle: state.currentQuestion ? state.currentQuestion.title : "",
    votedAt: Date.now()
  };

  // 1. Local Broadcast
  if (localBroadcast) {
    localBroadcast.postMessage({
      event: "VOTE",
      ...voteData
    });
  }

  // 2. Firebase Cloud Firestore 기록
  if (db && state.currentQuestion) {
    try {
      await db.collection("rooms")
        .doc(state.roomId)
        .collection("votes")
        .doc(state.nickname)
        .set(voteData, { merge: true });
    } catch (err) {
      console.warn("Firestore 투표 기록 경고:", err);
    }
  }
}

// 결과 수신 시 다수파/소수파 판정 및 UI 렌더링
function onResultsReceived(payload) {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  state.gameStatus = "result";

  const {
    questionTitle,
    optionA,
    optionB,
    countA,
    countB,
    majorityOption, // 'A' | 'B' | 'TIE' | 'NONE'
    percentA,
    percentB
  } = payload;

  document.getElementById("resultQuestionTitle").textContent = questionTitle;
  document.getElementById("resultOptionAText").textContent = optionA;
  document.getElementById("resultOptionBText").textContent = optionB;
  document.getElementById("resultOptionAPercent").textContent = `${percentA}% (${countA}명)`;
  document.getElementById("resultOptionBPercent").textContent = `${percentB}% (${countB}명)`;

  setTimeout(() => {
    document.getElementById("resultGaugeA").style.width = `${percentA}%`;
    document.getElementById("resultGaugeB").style.width = `${percentB}%`;
  }, 100);

  // [다수파 / 소수파 판정 로직]
  const container = document.getElementById("verdictContainer");
  const iconEl = document.getElementById("verdictIcon");
  const titleEl = document.getElementById("verdictTitle");
  const descEl = document.getElementById("verdictDesc");

  container.className = "p-6 rounded-2xl transition-all duration-500 ";

  if (!state.myChoice) {
    container.classList.add("bg-slate-800", "border", "border-slate-700");
    iconEl.textContent = "⏱️";
    titleEl.textContent = "투표 미참여";
    descEl.textContent = "제한 시간 내에 선택지를 고르지 못했습니다.";
  } else if (majorityOption === "TIE") {
    container.classList.add("badge-tie");
    iconEl.textContent = "⚖️";
    titleEl.textContent = "기적의 황금 밸런스!";
    descEl.textContent = `A와 B가 정확히 50:50으로 팽팽하게 맞섰습니다!`;
    SoundFx.playWin();
  } else if (state.myChoice === majorityOption) {
    const winPercent = majorityOption === "A" ? percentA : percentB;
    container.classList.add("badge-majority");
    iconEl.textContent = "👑";
    titleEl.textContent = "다수파 승리!";
    descEl.textContent = `전체 참가자의 ${winPercent}%가 당신과 같은 선택을 했습니다!`;
    SoundFx.playWin();

    if (window.confetti) {
      window.confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 }
      });
    }
  } else {
    const myPercent = state.myChoice === "A" ? percentA : percentB;
    container.classList.add("badge-minority");
    iconEl.textContent = "⚡";
    titleEl.textContent = "개성 넘치는 소수파!";
    descEl.textContent = `오직 ${myPercent}%만이 선택한 당신만의 특별한 취향!`;
  }

  switchScreen("result");
}

// 라운드 리셋 시
function onRoundReset() {
  state.gameStatus = "waiting";
  state.currentQuestion = null;
  state.myChoice = null;
  state.currentRoundKey = "";
  resetChoiceCards();
  switchScreen("waiting");
}

// 선택 카드 상태 복구
function resetChoiceCards() {
  const cardA = document.getElementById("cardOptionA");
  const cardB = document.getElementById("cardOptionB");
  cardA.classList.remove("selected");
  cardB.classList.remove("selected");
  cardA.style.pointerEvents = "auto";
  cardB.style.pointerEvents = "auto";
  document.getElementById("checkA").classList.add("hidden");
  document.getElementById("checkB").classList.add("hidden");
}

// 화면 전환 헬퍼
function switchScreen(screen) {
  document.getElementById("joinScreen").classList.add("hidden");
  document.getElementById("waitingScreen").classList.add("hidden");
  document.getElementById("votingScreen").classList.add("hidden");
  document.getElementById("resultScreen").classList.add("hidden");

  if (screen === "join") document.getElementById("joinScreen").classList.remove("hidden");
  else if (screen === "waiting") document.getElementById("waitingScreen").classList.remove("hidden");
  else if (screen === "voting") document.getElementById("votingScreen").classList.remove("hidden");
  else if (screen === "result") document.getElementById("resultScreen").classList.remove("hidden");
}

// Firebase 설정 모달 파서 & 열기/닫기
function autoParseFirebaseConfig() {
  const text = document.getElementById("cfgPasteArea").value;
  if (!text) return;

  const extract = (key) => {
    const match = text.match(new RegExp(`${key}["'\\s:]+([^"',\\s}]+)`));
    return match ? match[1] : "";
  };

  const projectId = extract("projectId");
  const apiKey = extract("apiKey");
  const appId = extract("appId");

  if (projectId) document.getElementById("cfgProjectId").value = projectId;
  if (apiKey) document.getElementById("cfgApiKey").value = apiKey;
  if (appId) document.getElementById("cfgAppId").value = appId;

  if (projectId) {
    alert("Firebase 설정 코드가 성공적으로 자동 분석되었습니다!");
  }
}

function openConfigModal() {
  const cfg = getFirebaseConfig();
  document.getElementById("cfgProjectId").value = cfg.projectId || "";
  document.getElementById("cfgApiKey").value = cfg.apiKey || "";
  document.getElementById("cfgAppId").value = cfg.appId || "";
  document.getElementById("configModal").classList.remove("hidden");
}

function closeConfigModal() {
  document.getElementById("configModal").classList.add("hidden");
}

function saveConfigModal() {
  const projectId = document.getElementById("cfgProjectId").value.trim();
  const apiKey = document.getElementById("cfgApiKey").value.trim();
  const appId = document.getElementById("cfgAppId").value.trim();

  if (!projectId) {
    alert("Project ID는 필수입니다!");
    return;
  }

  const newConfig = {
    apiKey,
    projectId,
    appId,
    authDomain: `${projectId}.firebaseapp.com`
  };

  saveFirebaseConfig(newConfig, state.roomId);
  closeConfigModal();
  db = initFirebase();
  updateConnectionBadge();
  if (state.nickname) {
    setupRealtimeListeners();
  }
  alert("Firebase 설정이 저장되었습니다!");
}
