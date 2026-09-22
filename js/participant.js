// ============================================================================
// 참가자 클라이언트 로직 (participant.js)
// Google Firebase (Cloud Firestore) + 결과 팝업 모달 + 강퇴 처리
// ============================================================================

let db = null;
let roomUnsubscribe = null;
let participantUnsubscribe = null;
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
  currentRoundKey: "",
  isKicked: false
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
      gain.gain.setValueAtTime(0.08, this.ctx.currentTime);
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
        gain.gain.setValueAtTime(0.2, now + i * 0.1);
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
    badge.className = "px-2.5 py-1 text-xs rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5 font-medium shadow-sm";
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span><span>Firebase (${cfg.projectId}) 연결됨</span>`;
  } else {
    badge.className = "px-2.5 py-1 text-xs rounded-full bg-sky-50 text-sky-700 border border-sky-200 flex items-center gap-1.5 font-medium shadow-sm";
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-sky-500"></span><span>${cfg.projectId} (로컬 모드)</span>`;
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
  state.isKicked = false;
  localStorage.setItem("balance_user_nickname", nickInput);
  localStorage.setItem("balance_room_id", roomInput);

  document.getElementById("displayNickname").textContent = nickInput;
  const roomDisplay = document.getElementById("displayRoomName");
  if (roomDisplay) roomDisplay.textContent = roomInput;

  switchScreen("waiting");
  setupRealtimeListeners();
}

// 실시간 동기화 설정 (Firestore + BroadcastChannel)
function setupRealtimeListeners() {
  const channelName = `balance_room_${state.roomId}`;

  // 1. Local BroadcastChannel
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

  // 2. Firebase Cloud Firestore 실시간 리스너
  db = initFirebase();
  if (db) {
    if (roomUnsubscribe) roomUnsubscribe();
    if (participantUnsubscribe) participantUnsubscribe();

    const roomRef = db.collection("rooms").doc(state.roomId);

    // 방 상태 감지
    roomUnsubscribe = roomRef.onSnapshot((doc) => {
      if (!doc.exists) return;
      const roomData = doc.data();

      // [요구사항 1] 강퇴 이벤트 감지
      if (roomData.kickedUser === state.nickname) {
        onKicked();
        return;
      }

      handleRoomStateFromFirestore(roomData);
    }, (err) => {
      console.warn("Firestore 실시간 리스너 경고:", err);
    });

    // 참가자 개별 문서 등록 및 강퇴 감지
    const myPartRef = roomRef.collection("participants").doc(state.nickname);
    myPartRef.set({
      nickname: state.nickname,
      lastActive: Date.now(),
      kicked: false
    }, { merge: true }).catch((err) => console.warn("참가자 등록 경고:", err));

    participantUnsubscribe = myPartRef.onSnapshot((doc) => {
      if (doc.exists) {
        const data = doc.data();
        if (data && data.kicked === true) {
          onKicked();
        }
      }
    });
  }
}

// Firestore 방 상태 변경 핸들러
function handleRoomStateFromFirestore(roomData) {
  if (!roomData || !roomData.status || state.isKicked) return;

  if (roomData.status === "voting") {
    const roundKey = `${roomData.startedAt}_${roomData.currentQuestion ? roomData.currentQuestion.id : ""}`;
    if (state.currentRoundKey !== roundKey) {
      state.currentRoundKey = roundKey;
      closeResultModal();
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
      closeResultModal();
      onRoundReset();
    }
  }
}

// 로컬 BroadcastChannel 이벤트 수신
function handleIncomingGameEvent(data) {
  if (!data || state.isKicked) return;

  // 강퇴 이벤트 수신
  if (data.event === "KICK_USER" && data.nickname === state.nickname) {
    onKicked();
    return;
  }

  switch (data.event) {
    case "START_ROUND":
      closeResultModal();
      onRoundStarted(data.payload);
      break;
    case "SHOW_RESULTS":
      onResultsReceived(data.payload);
      break;
    case "RESET_ROUND":
      closeResultModal();
      onRoundReset();
      break;
  }
}

// [요구사항 1] 강퇴 처리 로직
function onKicked() {
  state.isKicked = true;
  if (state.timerInterval) clearInterval(state.timerInterval);
  if (roomUnsubscribe) roomUnsubscribe();
  if (participantUnsubscribe) participantUnsubscribe();

  closeResultModal();
  document.getElementById("kickedModal").classList.remove("hidden");
}

function handleKickedConfirm() {
  document.getElementById("kickedModal").classList.add("hidden");
  state.isKicked = false;
  state.nickname = "";
  state.myChoice = null;
  localStorage.removeItem("balance_user_nickname");
  switchScreen("join");
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

// 투표 데이터 전송
async function sendVote(option) {
  const voteData = {
    nickname: state.nickname,
    option: option,
    questionId: state.currentQuestion ? state.currentQuestion.id : "unknown",
    questionTitle: state.currentQuestion ? state.currentQuestion.title : "",
    votedAt: Date.now()
  };

  if (localBroadcast) {
    localBroadcast.postMessage({
      event: "VOTE",
      ...voteData
    });
  }

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

// [요구사항 3] 결과 수신 시 다수파/소수파 판정 및 "팝업 모달" 띄우기
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

  // 배경 결과 뷰 업데이트
  document.getElementById("resultQuestionTitle").textContent = questionTitle;
  document.getElementById("resultOptionAText").textContent = optionA;
  document.getElementById("resultOptionBText").textContent = optionB;
  document.getElementById("resultOptionAPercent").textContent = `${percentA}% (${countA}명)`;
  document.getElementById("resultOptionBPercent").textContent = `${percentB}% (${countB}명)`;

  setTimeout(() => {
    document.getElementById("resultGaugeA").style.width = `${percentA}%`;
    document.getElementById("resultGaugeB").style.width = `${percentB}%`;
  }, 100);

  // 모달 요소
  const modalBox = document.getElementById("modalVerdictBox");
  const modalIcon = document.getElementById("modalVerdictIcon");
  const modalTitle = document.getElementById("modalVerdictTitle");
  const modalDesc = document.getElementById("modalVerdictDesc");
  const modalChoiceBadge = document.getElementById("modalMyChoiceBadge");
  const modalChoicePercent = document.getElementById("modalMyChoicePercent");

  // 인라인 카드 요소
  const inlineCard = document.getElementById("inlineVerdictCard");
  const inlineIcon = document.getElementById("inlineVerdictIcon");
  const inlineTitle = document.getElementById("inlineVerdictTitle");
  const inlineDesc = document.getElementById("inlineVerdictDesc");

  modalBox.className = "p-6 rounded-2xl text-white shadow-lg ";
  inlineCard.className = "p-5 rounded-2xl transition-all shadow-sm text-white ";

  let myPercent = 0;
  let isMajorityWin = false;

  if (!state.myChoice) {
    // 미투표
    const bgClass = "bg-slate-700";
    modalBox.classList.add(bgClass);
    inlineCard.classList.add(bgClass);
    modalIcon.textContent = inlineIcon.textContent = "⏱️";
    modalTitle.textContent = inlineTitle.textContent = "투표 미참여";
    modalDesc.textContent = inlineDesc.textContent = "시간 내에 선택지를 고르지 못했습니다.";
    modalChoiceBadge.textContent = "선택 안 함";
    modalChoiceBadge.className = "px-2 py-0.5 rounded text-white font-bold bg-slate-500";
    modalChoicePercent.textContent = "-";
  } else if (majorityOption === "TIE") {
    // 동률
    modalBox.classList.add("badge-tie");
    inlineCard.classList.add("badge-tie");
    modalIcon.textContent = inlineIcon.textContent = "⚖️";
    modalTitle.textContent = inlineTitle.textContent = "기적의 황금 밸런스!";
    modalDesc.textContent = inlineDesc.textContent = "A와 B가 정확히 50:50으로 팽팽하게 맞섰습니다!";
    modalChoiceBadge.textContent = state.myChoice === "A" ? "[A] 선택" : "[B] 선택";
    modalChoiceBadge.className = state.myChoice === "A" ? "px-2 py-0.5 rounded text-white font-bold bg-rose-500" : "px-2 py-0.5 rounded text-white font-bold bg-sky-600";
    modalChoicePercent.textContent = "50%";
    SoundFx.playWin();
  } else if (state.myChoice === majorityOption) {
    // 다수파
    isMajorityWin = true;
    myPercent = majorityOption === "A" ? percentA : percentB;
    modalBox.classList.add("badge-majority");
    inlineCard.classList.add("badge-majority");
    modalIcon.textContent = inlineIcon.textContent = "👑";
    modalTitle.textContent = inlineTitle.textContent = "당신은 [다수파] 승리!";
    modalDesc.textContent = inlineDesc.textContent = `전체 참가자의 ${myPercent}%가 당신과 같은 선택을 했습니다!`;
    modalChoiceBadge.textContent = state.myChoice === "A" ? "[A] 선택" : "[B] 선택";
    modalChoiceBadge.className = state.myChoice === "A" ? "px-2 py-0.5 rounded text-white font-bold bg-rose-500" : "px-2 py-0.5 rounded text-white font-bold bg-sky-600";
    modalChoicePercent.textContent = `${myPercent}% (다수파)`;

    SoundFx.playWin();
    if (window.confetti) {
      window.confetti({ particleCount: 90, spread: 75, origin: { y: 0.5 } });
    }
  } else {
    // 소수파
    myPercent = state.myChoice === "A" ? percentA : percentB;
    modalBox.classList.add("badge-minority");
    inlineCard.classList.add("badge-minority");
    modalIcon.textContent = inlineIcon.textContent = "⚡";
    modalTitle.textContent = inlineTitle.textContent = "당신은 [소수파] 당첨!";
    modalDesc.textContent = inlineDesc.textContent = `오직 ${myPercent}%만이 선택한 당신만의 특별한 취향!`;
    modalChoiceBadge.textContent = state.myChoice === "A" ? "[A] 선택" : "[B] 선택";
    modalChoiceBadge.className = state.myChoice === "A" ? "px-2 py-0.5 rounded text-white font-bold bg-rose-500" : "px-2 py-0.5 rounded text-white font-bold bg-sky-600";
    modalChoicePercent.textContent = `${myPercent}% (소수파)`;
  }

  // 화면 전환 (배경에 결과 화면 배치)
  switchScreen("result");

  // [요구사항 3] 다수/소수 알림 팝업 모달 띄우기
  document.getElementById("resultModal").classList.remove("hidden");
}

function closeResultModal() {
  document.getElementById("resultModal").classList.add("hidden");
}

// 라운드 리셋 시
function onRoundReset() {
  state.gameStatus = "waiting";
  state.currentQuestion = null;
  state.myChoice = null;
  state.currentRoundKey = "";
  closeResultModal();
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

// 설정 모달
function openConfigModal() {
  const cfg = getFirebaseConfig();
  document.getElementById("cfgProjectId").value = cfg.projectId || "";
  document.getElementById("cfgApiKey").value = cfg.apiKey || "";
  document.getElementById("configModal").classList.remove("hidden");
}

function closeConfigModal() {
  document.getElementById("configModal").classList.add("hidden");
}

function saveConfigModal() {
  const projectId = document.getElementById("cfgProjectId").value.trim();
  const apiKey = document.getElementById("cfgApiKey").value.trim();

  if (!projectId) {
    alert("Project ID는 필수입니다!");
    return;
  }

  saveFirebaseConfig({ projectId, apiKey }, state.roomId);
  closeConfigModal();
  db = initFirebase();
  updateConnectionBadge();
  alert("설정이 저장되었습니다!");
}
