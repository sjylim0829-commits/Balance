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
  gameStatus: "waiting", // 'waiting' | 'voting' | 'result' | 'final'
  timerInterval: null,
  duration: 15,
  startedAt: null,
  currentRoundKey: "",
  isKicked: false,
  score: 0, // [요구사항 3] 누적 점수 (0 ~ 100점)
  roundIndex: 1,
  totalRounds: 10,
  history: [], // [요구사항 4] 10문항 복기 기록
  hasParticipatedInCurrentRound: false // [요구사항 5] 현재 라운드 참여 여부 (접속하자마자 투표 미참여 모달 방지)
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

  // [요구사항 3] URL 파라미터 ?room= 확인 후 자동 채우기
  const urlParams = new URLSearchParams(window.location.search);
  const queryRoom = urlParams.get("room");
  const autoNotice = document.getElementById("roomCodeAutoNotice");
  const defaultNotice = document.getElementById("roomCodeDefaultNotice");

  if (queryRoom) {
    document.getElementById("roomInput").value = queryRoom.trim();
    if (autoNotice) autoNotice.classList.remove("hidden");
    if (defaultNotice) defaultNotice.classList.add("hidden");
  } else {
    const savedRoom = localStorage.getItem("balance_room_id");
    if (savedRoom) document.getElementById("roomInput").value = savedRoom;
    if (autoNotice) autoNotice.classList.add("hidden");
    if (defaultNotice) defaultNotice.classList.remove("hidden");
  }

  // 진행자가 방 코드를 바꾼 경우 입장 화면에서도 실시간 반영
  window.addEventListener("storage", (e) => {
    if (e.key === "balance_room_id" && e.newValue) {
      const roomInput = document.getElementById("roomInput");
      if (roomInput && (!state.gameStatus || state.gameStatus === "join")) {
        roomInput.value = e.newValue;
      }
    }
  });

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
  state.hasParticipatedInCurrentRound = false;
  state.score = 0;
  state.history = [];
  closeResultModal();

  localStorage.setItem("balance_user_nickname", nickInput);
  localStorage.setItem("balance_room_id", roomInput);

  document.getElementById("displayNickname").textContent = nickInput;
  const roomDisplay = document.getElementById("displayRoomName");
  if (roomDisplay) roomDisplay.textContent = roomInput;

  // [요구사항 5] 참여 직후에는 무조건 대기실 화면으로 입장
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

    // [요구사항 4] 접속 시 이미 강퇴된 상태인지 먼저 확인
    myPartRef.get().then((docSnap) => {
      if (docSnap.exists && docSnap.data().kicked === true) {
        onKicked();
      } else {
        myPartRef.set({
          nickname: state.nickname,
          lastActive: Date.now(),
          kicked: false
        }, { merge: true }).catch((err) => console.warn("참가자 등록 경고:", err));
      }
    }).catch(() => {
      myPartRef.set({
        nickname: state.nickname,
        lastActive: Date.now(),
        kicked: false
      }, { merge: true }).catch((err) => console.warn("참가자 등록 경고:", err));
    });

    participantUnsubscribe = myPartRef.onSnapshot((doc) => {
      if (doc.exists) {
        const data = doc.data();
        if (data && data.kicked === true) {
          onKicked();
        } else if (data && data.kicked === false && state.isKicked) {
          // [요구사항 4] 호스트가 전체 초기화하여 강퇴가 해제된 경우 자동 복귀
          state.isKicked = false;
          document.getElementById("kickedModal").classList.add("hidden");
          switchScreen("waiting");
        }
      }
    });
  }
}

// Firestore 방 상태 변경 핸들러
function handleRoomStateFromFirestore(roomData) {
  if (!roomData || !roomData.status || state.isKicked) return;

  if (roomData.status === "room_changed" && roomData.newRoom && roomData.newRoom !== state.roomId) {
    state.roomId = roomData.newRoom;
    localStorage.setItem("balance_room_id", roomData.newRoom);
    const roomDisplay = document.getElementById("displayRoomName");
    if (roomDisplay) roomDisplay.textContent = roomData.newRoom;
    setupRealtimeListeners();
    return;
  }

  if (roomData.status === "voting") {
    const roundKey = `${roomData.startedAt}_${roomData.currentQuestion ? roomData.currentQuestion.id : ""}`;
    if (state.currentRoundKey !== roundKey) {
      state.currentRoundKey = roundKey;
      closeResultModal();
      onRoundStarted({
        roundIndex: roomData.roundIndex || 1,
        totalRounds: roomData.totalRounds || 10,
        question: roomData.currentQuestion,
        duration: roomData.duration || 15,
        startedAt: roomData.startedAt || Date.now()
      });
    }
  } else if (roomData.status === "result") {
    // [요구사항 5] 만약 현재 라운드를 진행하지 않고 방에 막 들어온 경우(대기 상태),
    // 이전 라운드 결과 팝업(투표 미참여)을 띄우지 않고 대기실 화면을 그대로 유지합니다.
    if (!state.hasParticipatedInCurrentRound) {
      return;
    }
    if (roomData.resultSummary && state.gameStatus !== "result") {
      onResultsReceived(roomData.resultSummary);
    }
  } else if (roomData.status === "waiting") {
    closeResultModal();
    state.hasParticipatedInCurrentRound = false;
    state.myChoice = null;
    if (state.gameStatus !== "waiting") {
      onRoundReset();
    }
  } else if (roomData.status === "final") {
    if (state.gameStatus !== "final") {
      closeResultModal();
      showFinalScreen(roomData.finalSummary);
    }
  }
}

// 로컬 BroadcastChannel 이벤트 수신
function handleIncomingGameEvent(data) {
  if (!data) return;

  // 진행자 방 코드 변경 이벤트 수신
  if (data.event === "ROOM_CODE_CHANGED" && data.newRoom && data.newRoom !== state.roomId) {
    state.roomId = data.newRoom;
    localStorage.setItem("balance_room_id", data.newRoom);
    const roomDisplay = document.getElementById("displayRoomName");
    if (roomDisplay) roomDisplay.textContent = data.newRoom;
    setupRealtimeListeners();
    return;
  }

  // 전체 게임 리셋 이벤트 수신 (강퇴 해제 및 대기실 복귀)
  if (data.event === "RESET_GAME") {
    onResetEntireGame();
    return;
  }

  if (state.isKicked) return;

  // 강퇴 이벤트 수신
  if (data.event === "KICK_USER" && data.nickname === state.nickname) {
    onKicked();
    return;
  }

  // payload 안전 접근 (Broadcast 또는 Firestore 객체 대응)
  const payload = data.payload || data;

  switch (data.event) {
    case "START_ROUND":
      closeResultModal();
      onRoundStarted(payload);
      break;
    case "SHOW_RESULTS":
      if (!state.hasParticipatedInCurrentRound) return;
      onResultsReceived(payload);
      break;
    case "RESET_ROUND":
      closeResultModal();
      onRoundReset();
      break;
    case "FINAL_RESULTS":
      closeResultModal();
      showFinalScreen(payload);
      break;
  }
}

// [요구사항 1] 강퇴 처리 로직
function onKicked() {
  state.isKicked = true;
  if (state.timerInterval) clearInterval(state.timerInterval);
  if (roomUnsubscribe) roomUnsubscribe();
  // participantUnsubscribe는 남겨두어 호스트가 초기화 시 실시간 복귀를 감지할 수 있도록 함

  closeResultModal();
  document.getElementById("kickedModal").classList.remove("hidden");
}

function handleKickedConfirm() {
  document.getElementById("kickedModal").classList.add("hidden");
  state.isKicked = false;
  state.nickname = "";
  state.myChoice = null;
  state.score = 0;
  state.history = [];
  if (roomUnsubscribe) roomUnsubscribe();
  if (participantUnsubscribe) participantUnsubscribe();
  localStorage.removeItem("balance_user_nickname");
  switchScreen("join");
}

// 전체 게임 초기화 (호스트 리셋 시 강퇴 해제 및 대기실 복귀)
function onResetEntireGame() {
  state.isKicked = false;
  state.hasParticipatedInCurrentRound = false;
  state.score = 0;
  state.history = [];
  state.myChoice = null;
  state.currentRoundKey = "";
  state.currentQuestion = null;

  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  closeResultModal();
  document.getElementById("kickedModal").classList.add("hidden");

  const userScoreText = document.getElementById("userScoreText");
  if (userScoreText) userScoreText.textContent = "0점";

  const scoreBadge = document.getElementById("userScoreBadge");
  if (scoreBadge) scoreBadge.classList.add("hidden");

  const roundBadge = document.getElementById("userRoundBadge");
  if (roundBadge) roundBadge.classList.add("hidden");

  resetChoiceCards();
  if (state.nickname) {
    switchScreen("waiting");
    setupRealtimeListeners();
  } else {
    switchScreen("join");
  }
}

// 라운드 시작 이벤트 수신 시
function onRoundStarted(payload) {
  if (!payload || !payload.question) return;

  state.gameStatus = "voting";
  state.hasParticipatedInCurrentRound = true;
  state.currentQuestion = payload.question;
  state.duration = payload.duration || 15;
  state.startedAt = payload.startedAt || Date.now();
  state.myChoice = null;
  state.roundIndex = payload.roundIndex || (state.history.length + 1);
  state.totalRounds = payload.totalRounds || 10;

  // 1번 문제로 다시 시작되었을 때 점수 및 복기 리셋
  if (state.roundIndex === 1 && state.history.length > 0) {
    state.score = 0;
    state.history = [];
  }

  // 상단 헤더 배지 갱신
  const roundBadge = document.getElementById("userRoundBadge");
  if (roundBadge) {
    roundBadge.textContent = `Q ${state.roundIndex}/${state.totalRounds}`;
    roundBadge.classList.remove("hidden");
  }
  const scoreBadge = document.getElementById("userScoreBadge");
  const scoreText = document.getElementById("userScoreText");
  if (scoreBadge && scoreText) {
    scoreText.textContent = `${state.score}점`;
    scoreBadge.classList.remove("hidden");
  }

  // 마감 안내문 숨김
  const closedNotice = document.getElementById("votingClosedNotice");
  if (closedNotice) closedNotice.classList.add("hidden");

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
      
      const closedNotice = document.getElementById("votingClosedNotice");
      if (closedNotice) closedNotice.classList.remove("hidden");
      timerText.textContent = "0s (마감)";
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
  if (!payload) return;

  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  state.gameStatus = "result";

  const {
    roundIndex = state.roundIndex,
    questionTitle,
    optionA,
    optionB,
    countA,
    countB,
    majorityOption, // 'A' | 'B' | 'TIE' | 'NONE'
    percentA,
    percentB
  } = payload;

  state.roundIndex = roundIndex;

  // 배경 결과 뷰 업데이트
  document.getElementById("resultQuestionTitle").textContent = questionTitle || "";
  document.getElementById("resultOptionAText").textContent = optionA || "";
  document.getElementById("resultOptionBText").textContent = optionB || "";
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

  modalBox.className = "p-5 rounded-2xl text-white shadow-lg ";
  inlineCard.className = "p-5 rounded-2xl transition-all shadow-sm text-white ";

  let myPercent = 0;
  let isMajorityWin = false;
  let roundPoints = 0;

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
    // 동률 (50:50) - 모두 다수파로 인정 (+10점)
    isMajorityWin = true;
    roundPoints = 10;
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
    // 다수파 (+10점)
    isMajorityWin = true;
    roundPoints = 10;
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
    // 소수파 (0점)
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

  // [요구사항 3] 라운드별 점수 및 누적 점수 반영 (중복 방지)
  const existingHistoryIdx = state.history.findIndex((h) => h.roundIndex === roundIndex);
  if (existingHistoryIdx === -1) {
    state.score = Math.min(100, state.score + roundPoints);
    state.history.push({
      roundIndex,
      questionTitle: questionTitle || `문제 ${roundIndex}`,
      myChoice: state.myChoice,
      majorityOption,
      isMajority: isMajorityWin,
      pointsEarned: roundPoints
    });
  }

  // 모달 점수 피드백 배지
  const modalScoreBadge = document.getElementById("modalRoundScoreBadge");
  if (modalScoreBadge) {
    if (roundPoints > 0) {
      modalScoreBadge.textContent = "+10점 획득! 🎯";
      modalScoreBadge.className = "mt-2.5 inline-block px-3 py-1 rounded-full bg-emerald-500 text-white font-black text-xs shadow-sm";
    } else {
      modalScoreBadge.textContent = "+0점 (소수파/미선택)";
      modalScoreBadge.className = "mt-2.5 inline-block px-3 py-1 rounded-full bg-white/20 backdrop-blur-sm text-xs font-medium text-white/90";
    }
  }

  // 모달 및 인라인 누적 점수 갱신
  const modalCumulative = document.getElementById("modalCumulativeScore");
  if (modalCumulative) modalCumulative.textContent = state.score;

  const modalBar = document.getElementById("modalScoreBar");
  if (modalBar) modalBar.style.width = `${state.score}%`;

  const inlineCumulative = document.getElementById("inlineCumulativeScore");
  if (inlineCumulative) inlineCumulative.textContent = state.score;

  const userScoreText = document.getElementById("userScoreText");
  if (userScoreText) userScoreText.textContent = `${state.score}점`;

  // 화면 전환
  switchScreen("result");

  // 모달 띄우기
  document.getElementById("resultModal").classList.remove("hidden");
}

function closeResultModal() {
  document.getElementById("resultModal").classList.add("hidden");
}

// [요구사항 4] 10문항 완료 시 학교 대다수 일치율 발표 화면
function showFinalScreen(payload) {
  state.gameStatus = "final";
  closeResultModal();
  switchScreen("final");

  const totalAnswered = state.history.length || 10;
  const matchCount = state.history.filter((h) => h.isMajority).length;
  const matchPercent = Math.round((matchCount / totalAnswered) * 100);

  // 대형 일치율 메시지
  const matchPercentEl = document.getElementById("finalMatchPercent");
  if (matchPercentEl) {
    matchPercentEl.textContent = `${matchPercent}%`;
  }

  const scoreTag = document.getElementById("finalScoreTag");
  if (scoreTag) {
    scoreTag.textContent = `최종 점수: ${state.score}점 / 100점 (${matchCount}/${totalAnswered} 문항 다수파 일치)`;
  }

  // 교사 공감 페르소나 매핑
  const emojiEl = document.getElementById("finalPersonaIcon");
  const titleEl = document.getElementById("finalPersonaTitle");
  const descEl = document.getElementById("finalPersonaDesc");

  let emoji = "🏆";
  let title = "교무실 핵인싸 선생님";
  let desc = "동료 선생님들의 마음을 꿰뚫어보는 영혼의 단짝! 학교 분위기를 이끄는 최고의 공감 리더입니다.";

  if (matchPercent >= 90) {
    emoji = "🏆";
    title = "공감 만렙! 교무실 핵인싸 선생님";
    desc = "동료 선생님들의 마음을 꿰뚫어보는 영혼의 단짝! 학교 분위기를 언제나 밝고 훈훈하게 이끄는 최고의 공감 리더입니다.";
  } else if (matchPercent >= 70) {
    emoji = "⭐";
    title = "대중의 감각을 지닌 따뜻한 공감형 선생님";
    desc = "선생님의 선택과 가치관은 언제나 많은 동료 교사들의 든든한 공감과 지지를 얻고 있습니다.";
  } else if (matchPercent >= 50) {
    emoji = "⚖️";
    title = "균형과 개성을 모두 갖춘 스마트 밸런서 선생님";
    desc = "때로는 다수의 의견을 존중하고, 때로는 나만의 뚜렷한 주관을 지키는 황금 밸런스의 소유자입니다.";
  } else if (matchPercent >= 30) {
    emoji = "💡";
    title = "남다른 시각의 창의적인 개성파 선생님";
    desc = "남들이 미처 보지 못하는 신선한 관점과 독창적인 통찰력으로 교무실에 활력을 불어넣어 줍니다.";
  } else {
    emoji = "🚀";
    title = "우주 최강 유니크! 1% 독보적 감각의 마이웨이 선생님";
    desc = "다수의 흐름에 휩쓸리지 않고 나만의 확고한 교육관과 소신을 지닌 멋진 개척자입니다!";
  }

  if (emojiEl) emojiEl.textContent = emoji;
  if (titleEl) titleEl.textContent = title;
  if (descEl) descEl.textContent = desc;

  // 10문항 내 선택 내역 렌더링
  const historyList = document.getElementById("finalHistoryList");
  if (historyList) {
    historyList.innerHTML = "";
    state.history.forEach((h) => {
      const row = document.createElement("div");
      row.className = "p-2.5 rounded-xl bg-slate-50 border border-slate-200 flex justify-between items-center";

      const isWin = h.isMajority;
      const badgeClass = isWin ? "bg-emerald-100 text-emerald-800 border-emerald-200" : "bg-purple-100 text-purple-800 border-purple-200";
      const badgeText = isWin ? "👑 다수파 (+10점)" : "⚡ 소수파 (0점)";
      const choiceText = h.myChoice ? `[${h.myChoice}] 선택` : "미투표";

      row.innerHTML = `
        <div class="truncate max-w-[210px]">
          <span class="font-bold text-slate-800 block text-xs truncate">Q${h.roundIndex}. ${escapeHtml(h.questionTitle)}</span>
          <span class="text-[11px] text-slate-500">${choiceText}</span>
        </div>
        <span class="px-2 py-0.5 rounded-md text-[11px] font-bold border ${badgeClass} shrink-0">
          ${badgeText}
        </span>
      `;
      historyList.appendChild(row);
    });
  }

  if (window.confetti) {
    window.confetti({ particleCount: 110, spread: 80, origin: { y: 0.4 } });
  }
}

// 라운드 리셋 시
function onRoundReset() {
  state.gameStatus = "waiting";
  state.hasParticipatedInCurrentRound = false;
  state.currentQuestion = null;
  state.myChoice = null;
  state.currentRoundKey = "";
  closeResultModal();
  resetChoiceCards();
  const closedNotice = document.getElementById("votingClosedNotice");
  if (closedNotice) closedNotice.classList.add("hidden");
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
  const finalScreen = document.getElementById("finalScreen");
  if (finalScreen) finalScreen.classList.add("hidden");

  if (screen === "join") document.getElementById("joinScreen").classList.remove("hidden");
  else if (screen === "waiting") document.getElementById("waitingScreen").classList.remove("hidden");
  else if (screen === "voting") document.getElementById("votingScreen").classList.remove("hidden");
  else if (screen === "result") document.getElementById("resultScreen").classList.remove("hidden");
  else if (screen === "final" && finalScreen) finalScreen.classList.remove("hidden");
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
