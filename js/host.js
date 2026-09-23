// ============================================================================
// 진행자(Host) 콘솔 로직 (host.js)
// Google Firebase (Cloud Firestore) + PIN 보안 게이트 + 참가자 내보내기
// ============================================================================

let db = null;
let participantsUnsubscribe = null;
let votesUnsubscribe = null;
let localBroadcast = null;

// 진행자 상태 객체
const hostState = {
  roomId: "default",
  status: "waiting", // 'waiting' | 'voting' | 'result' | 'final'
  duration: 15,
  startedAt: null,
  timerInterval: null,
  selectedQuestion: null,
  currentQuestionIndex: 0,
  totalQuestions: 10,
  
  // 참가자 실시간 상태 관리
  connectedParticipants: new Map(), // nickname -> { nickname, joinedAt }
  roundVotes: new Map(),             // nickname -> { option, votedAt }
  
  // 누적 통계 기록
  historyRounds: [],
  currentFilter: "ALL",
  
  // Chart.js 인스턴스
  donutChart: null,
  historyBarChart: null
};

// PIN 번호 헬퍼
function getHostPin() {
  return localStorage.getItem("balance_host_pin") || "1234";
}

// [요구사항 2] 진행자 인증 게이트 핸들러
function handleHostAuth(e) {
  e.preventDefault();
  const inputPin = document.getElementById("hostPinInput").value.trim();
  const correctPin = getHostPin();

  if (inputPin === correctPin) {
    sessionStorage.setItem("balance_host_authenticated", "true");
    unlockHostDashboard();
  } else {
    alert("PIN 번호가 일치하지 않습니다. 다시 입력해 주세요.");
    document.getElementById("hostPinInput").value = "";
    document.getElementById("hostPinInput").focus();
  }
}

function handleHostLogout() {
  sessionStorage.removeItem("balance_host_authenticated");
  document.getElementById("hostLockScreen").classList.remove("hidden");
  document.getElementById("hostMainDashboard").classList.add("hidden");
}

function unlockHostDashboard() {
  document.getElementById("hostLockScreen").classList.add("hidden");
  document.getElementById("hostMainDashboard").classList.remove("hidden");

  // 대시보드 활성화 시 초기화
  initHostDashboard();
}

// 페이지 로드 시 초기화
window.addEventListener("DOMContentLoaded", () => {
  const isAuthed = sessionStorage.getItem("balance_host_authenticated") === "true";
  if (isAuthed) {
    unlockHostDashboard();
  } else {
    document.getElementById("hostLockScreen").classList.remove("hidden");
    document.getElementById("hostMainDashboard").classList.add("hidden");
  }
});

// 호스트 대시보드 로드
function initHostDashboard() {
  const urlParams = new URLSearchParams(window.location.search);
  const queryRoom = urlParams.get("room");
  if (queryRoom) {
    hostState.roomId = queryRoom.trim();
    localStorage.setItem("balance_room_id", hostState.roomId);
  } else {
    hostState.roomId = getRoomId();
  }

  const quickInput = document.getElementById("quickRoomInput");
  if (quickInput) quickInput.value = hostState.roomId;

  const cfgRoom = document.getElementById("cfgRoomInput");
  if (cfgRoom) cfgRoom.value = hostState.roomId;

  const displayBadge = document.getElementById("currentActiveRoomBadge");
  if (displayBadge) displayBadge.textContent = `현재: ${hostState.roomId}`;

  document.getElementById("cfgHostPin").value = getHostPin();

  initQuestionPresets();

  db = initFirebase();
  updateHostConnectionBadge();
  setupHostRealtimeListeners();
  initCharts();
  renderParticipantTags();
  updateLiveVoteGauge();
}

// 토스트 안내 알림 표시 헬퍼
function showToastNotification(message, isError = false) {
  const toast = document.getElementById("hostToast");
  const text = document.getElementById("hostToastText");
  const icon = document.getElementById("hostToastIcon");
  if (!toast || !text) {
    alert(message);
    return;
  }
  text.textContent = message;
  if (icon) icon.textContent = isError ? "⚠️" : "✅";

  toast.classList.remove("-translate-y-4", "opacity-0", "pointer-events-none");
  toast.classList.add("translate-y-0", "opacity-100");

  if (window.hostToastTimeout) clearTimeout(window.hostToastTimeout);
  window.hostToastTimeout = setTimeout(() => {
    toast.classList.add("-translate-y-4", "opacity-0", "pointer-events-none");
    toast.classList.remove("translate-y-0", "opacity-100");
  }, 3500);
}

// 텍스트 클립보드 복사 헬퍼 (모든 브라우저 및 file://, http://, https:// 100% 호환)
function copyTextToClipboard(text) {
  let success = false;
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "-9999px";
    textArea.setAttribute("readonly", "");
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, 99999);
    success = document.execCommand("copy");
    document.body.removeChild(textArea);
  } catch (e) {
    success = false;
  }

  if (!success && navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => false);
  }

  return Promise.resolve(success);
}

// 참가자 공유용 URL 생성 헬퍼
function getParticipantShareUrl(roomId) {
  const room = roomId || hostState.roomId || "default";
  const protocol = window.location.protocol;
  const host = window.location.host;
  let path = window.location.pathname;

  // 로컬 파일 (file://) 환경
  if (protocol === "file:") {
    if (path.endsWith("host.html")) {
      path = path.replace(/host\.html$/, "index.html");
    } else {
      path = path.replace(/\/[^/]*$/, "/index.html");
    }
    return `file://${path}?room=${encodeURIComponent(room)}`;
  }

  // 웹 서버 (http: / https:) 환경
  if (path.endsWith("host.html")) {
    path = path.replace(/host\.html$/, "index.html");
  } else if (!path.endsWith("index.html")) {
    path = path.replace(/\/[^/]*$/, "/index.html");
  }

  return `${protocol}//${host}${path}?room=${encodeURIComponent(room)}`;
}

// [요구사항 2] 진행자 방 코드 자유 변경
async function applyRoomCodeChange(customRoom, isSilent = false) {
  const input = document.getElementById("quickRoomInput");
  const newRoom = (customRoom || (input ? input.value.trim() : "")) || "default";

  if (newRoom === hostState.roomId && !customRoom) {
    showToastNotification(`이미 현재 방 코드('${newRoom}')로 설정되어 있습니다.`);
    return;
  }

  if (hostState.status === "voting" && !isSilent) {
    if (!confirm("현재 투표가 진행 중입니다. 새 방으로 전환하시겠습니까?")) return;
  }

  const oldRoom = hostState.roomId;

  if (hostState.timerInterval) {
    clearInterval(hostState.timerInterval);
    hostState.timerInterval = null;
  }

  hostState.roomId = newRoom;
  localStorage.setItem("balance_room_id", newRoom);

  if (input) input.value = newRoom;
  const cfgRoom = document.getElementById("cfgRoomInput");
  if (cfgRoom) cfgRoom.value = newRoom;

  const displayBadge = document.getElementById("currentActiveRoomBadge");
  if (displayBadge) displayBadge.textContent = `현재: ${newRoom}`;

  // URL 파라미터 갱신 (?room=newRoom)
  try {
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("room", newRoom);
    window.history.replaceState({}, "", newUrl.toString());
  } catch (e) {}

  // 기존 상태 초기화
  hostState.connectedParticipants.clear();
  hostState.roundVotes.clear();
  hostState.historyRounds = [];
  hostState.status = "waiting";
  selectQuestionByIndex(0);

  // 이전 방에 연결되어 있던 참가자들에게 방 변경 알림 브로드캐스트
  if (localBroadcast && oldRoom && oldRoom !== newRoom) {
    try {
      localBroadcast.postMessage({
        event: "ROOM_CODE_CHANGED",
        oldRoom: oldRoom,
        newRoom: newRoom
      });
    } catch (e) {}
  }

  // Firestore & Broadcast 채널 재연결
  setupHostRealtimeListeners();

  // Firestore 새 방 초기 문서 설정 (status: waiting)
  if (db) {
    db.collection("rooms").doc(hostState.roomId).set({
      status: "waiting",
      roundIndex: 1,
      totalRounds: hostState.totalQuestions,
      currentQuestion: hostState.selectedQuestion,
      resultSummary: null,
      kickedUser: null,
      createdAt: Date.now()
    }, { merge: true }).catch((e) => console.warn("방 생성 Firestore 경고:", e));

    if (oldRoom && oldRoom !== newRoom) {
      db.collection("rooms").doc(oldRoom).set({
        status: "room_changed",
        newRoom: newRoom,
        updatedAt: Date.now()
      }, { merge: true }).catch(() => {});
    }
  }

  renderParticipantTags();
  updateLiveVoteGauge();

  // 통계 차트 및 테이블 초기화
  if (hostState.donutChart) {
    hostState.donutChart.data.datasets[0].data = [0, 0];
    hostState.donutChart.update();
  }
  if (hostState.historyBarChart) {
    hostState.historyBarChart.data.labels = [];
    hostState.historyBarChart.data.datasets[0].data = [];
    hostState.historyBarChart.data.datasets[1].data = [];
    hostState.historyBarChart.update();
  }
  const tbody = document.getElementById("participantResultTableBody");
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-slate-400 text-xs">방 코드가 '${newRoom}'(으)로 변경되었습니다. 참가자들이 접속하면 여기에 표시됩니다.</td></tr>`;
  }
  const rankList = document.getElementById("majorityRankList");
  if (rankList) {
    rankList.innerHTML = `<p class="text-slate-400">참가자 투표가 쌓이면 순위가 표시됩니다.</p>`;
  }

  // 버튼 피드백 애니메이션
  const btn = document.getElementById("btnApplyRoomCode");
  if (btn) {
    const originalText = btn.innerHTML;
    btn.innerHTML = `<span>✅</span> <span>변경됨</span>`;
    setTimeout(() => {
      btn.innerHTML = originalText;
    }, 1500);
  }

  if (!isSilent) {
    showToastNotification(`🔑 방 코드가 '${newRoom}'(으)로 변경되었습니다!\n참가자들에게 '${newRoom}' 코드를 알려주세요.`);
  }
}

// [요구사항 2] 참가자용 링크 복사 (방 코드 자동 입력 링크)
async function copyParticipantLink() {
  const quickInput = document.getElementById("quickRoomInput");
  const typedRoom = (quickInput ? quickInput.value.trim() : "") || "default";

  // 만약 입력창에 새 방 코드를 적고 [변경]을 누르지 않은 채 [링크 복사]를 누른 경우, 자동으로 방 코드 변경 적용
  if (typedRoom !== hostState.roomId) {
    await applyRoomCodeChange(typedRoom, true);
  }

  const fullLink = getParticipantShareUrl(hostState.roomId);
  const copied = await copyTextToClipboard(fullLink);

  // 버튼 시각적 피드백
  const btn = document.getElementById("btnCopyParticipantLink");
  if (btn) {
    const originalContent = btn.innerHTML;
    btn.innerHTML = `<span>✅</span> <span>링크 복사 완료!</span>`;
    btn.classList.remove("bg-slate-100", "text-slate-700");
    btn.classList.add("bg-emerald-50", "text-emerald-700", "border-emerald-300");
    setTimeout(() => {
      btn.innerHTML = originalContent;
      btn.classList.remove("bg-emerald-50", "text-emerald-700", "border-emerald-300");
      btn.classList.add("bg-slate-100", "text-slate-700");
    }, 2500);
  }

  if (copied) {
    showToastNotification(`📋 참가 링크가 클립보드에 복사되었습니다!\n방 코드: [ ${hostState.roomId} ]\n링크: ${fullLink}`);
  } else {
    prompt(`아래 참가 링크를 복사하여 참가자들에게 공유하세요 (방 코드: ${hostState.roomId}):`, fullLink);
  }
}

// [요구사항 1, 4] 전체 게임 초기화 (질문 목록 제외: 실시간 참가자 명단, 투표 현황, 누적 통계 완전 리셋)
async function handleResetEntireGame() {
  if (!confirm("전체 게임을 초기화하시겠습니까?\n\n• 질문 목록을 제외한 모든 기록(실시간 참가자 명단, 투표 현황, 통계)이 완전히 초기화됩니다.\n• 1번 문제부터 다시 시작합니다.")) {
    return;
  }

  if (hostState.timerInterval) {
    clearInterval(hostState.timerInterval);
    hostState.timerInterval = null;
  }

  // 1. 상태 변수 완전 초기화 (실시간 참가자 목록 포함)
  hostState.status = "waiting";
  hostState.connectedParticipants.clear();
  hostState.roundVotes.clear();
  hostState.historyRounds = [];
  selectQuestionByIndex(0);

  // 2. UI 제어기 리셋
  document.getElementById("gameStatusBadge").className = "px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200";
  document.getElementById("gameStatusBadge").textContent = "대기 중 (Waiting)";

  const btnStart = document.getElementById("btnStartGame");
  const btnStartText = document.getElementById("btnStartGameText");
  btnStart.disabled = false;
  btnStart.className = "col-span-2 sm:col-span-4 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-black text-sm shadow-md shadow-emerald-500/20 transition flex items-center justify-center gap-2 cursor-pointer";
  btnStart.onclick = handleStartRound;
  if (btnStartText) btnStartText.textContent = "1번 문제 시작";

  document.getElementById("btnStopTimer").disabled = true;
  document.getElementById("btnStopTimer").className = "py-2.5 px-2 rounded-xl bg-slate-100 text-slate-400 font-bold text-xs border border-slate-200 cursor-not-allowed flex items-center justify-center gap-1.5";

  document.getElementById("hostTimerText").textContent = "--s";
  const finalBox = document.getElementById("finalAnnounceBox");
  if (finalBox) finalBox.classList.add("hidden");

  // 3. 개별 선택 내역 테이블 & 필터 카운트 & 요약 카드 초기화
  const tbody = document.getElementById("participantResultTableBody");
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-slate-400 text-xs">게임이 초기화되었습니다. 문제를 시작하면 참가자별 선택 내역이 여기에 출력됩니다.</td></tr>`;
  }
  const fAll = document.getElementById("filterCountALL"); if (fAll) fAll.textContent = "0";
  const fA = document.getElementById("filterCountA"); if (fA) fA.textContent = "0";
  const fB = document.getElementById("filterCountB"); if (fB) fB.textContent = "0";
  const fNone = document.getElementById("filterCountNONE"); if (fNone) fNone.textContent = "0";
  const rCountA = document.getElementById("hostResultCountA"); if (rCountA) rCountA.textContent = "0표";
  const rPercentA = document.getElementById("hostResultPercentA"); if (rPercentA) rPercentA.textContent = "0%";
  const rCountB = document.getElementById("hostResultCountB"); if (rCountB) rCountB.textContent = "0표";
  const rPercentB = document.getElementById("hostResultPercentB"); if (rPercentB) rPercentB.textContent = "0%";

  // 4. 누적 통계 차트 및 랭킹 초기화
  const rankList = document.getElementById("majorityRankList");
  if (rankList) {
    rankList.innerHTML = `<p class="text-slate-400">여러 라운드를 진행하면 랭킹이 집계됩니다.</p>`;
  }
  if (hostState.donutChart) {
    hostState.donutChart.data.datasets[0].data = [0, 0];
    hostState.donutChart.update();
  }
  if (hostState.historyBarChart) {
    hostState.historyBarChart.data.labels = [];
    hostState.historyBarChart.data.datasets[0].data = [];
    hostState.historyBarChart.data.datasets[1].data = [];
    hostState.historyBarChart.update();
  }

  // 5. 실시간 참가자 관리 탭 UI 리셋
  renderParticipantTags();
  updateLiveVoteGauge();

  // 6. Local Broadcast 로 전체 클라이언트에 RESET_GAME 전송
  const resetMsg = {
    event: "RESET_GAME",
    roomId: hostState.roomId,
    timestamp: Date.now()
  };
  if (localBroadcast) {
    localBroadcast.postMessage({
      ...resetMsg,
      payload: resetMsg
    });
  }

  // 7. Firebase Cloud Firestore 완전 초기화 (참가자 컬렉션 및 투표 컬렉션 전체 삭제)
  if (db) {
    try {
      const roomRef = db.collection("rooms").doc(hostState.roomId);

      // (A) 기존 투표 컬렉션 전체 삭제
      const votesRef = roomRef.collection("votes");
      const votesSnap = await votesRef.get();
      if (!votesSnap.empty) {
        const batch1 = db.batch();
        votesSnap.forEach((d) => batch1.delete(d.ref));
        await batch1.commit();
      }

      // (B) 참가자 컬렉션 전체 삭제 (실시간 참가자 관리 탭 포함 완전 초기화)
      const partRef = roomRef.collection("participants");
      const partSnap = await partRef.get();
      if (!partSnap.empty) {
        const batch2 = db.batch();
        partSnap.forEach((d) => batch2.delete(d.ref));
        await batch2.commit();
      }

      // (C) 방 메인 문서 초기화
      await roomRef.set({
        status: "waiting",
        roundIndex: 1,
        totalRounds: hostState.totalQuestions,
        currentQuestion: hostState.selectedQuestion,
        resultSummary: null,
        finalSummary: null,
        kickedUser: null,
        resetAt: Date.now()
      });
    } catch (err) {
      console.warn("Firestore 게임 초기화 경고:", err);
    }
  }

  // 삭제 완료 후 UI 재확인
  renderParticipantTags();
  updateLiveVoteGauge();

  showToastNotification("♻️ 참가자 명단 및 모든 게임 기록이 초기화되었습니다.\n(질문 목록은 유지됩니다)");
}

// 프리셋 드롭다운 초기화
function initQuestionPresets() {
  const select = document.getElementById("presetSelect");
  select.innerHTML = "";

  DEFAULT_QUESTIONS.forEach((q, idx) => {
    const opt = document.createElement("option");
    opt.value = idx;
    opt.textContent = `Q${idx + 1}. [${q.category}] ${q.title}`;
    select.appendChild(opt);
  });

  selectQuestionByIndex(0);
}

// 인덱스 기반 문제 선택
function selectQuestionByIndex(idx) {
  if (idx < 0) idx = 0;
  if (idx >= DEFAULT_QUESTIONS.length) idx = DEFAULT_QUESTIONS.length - 1;

  hostState.currentQuestionIndex = idx;
  const q = DEFAULT_QUESTIONS[idx];
  if (!q) return;

  hostState.selectedQuestion = {
    id: q.id,
    title: q.title,
    optionA: q.optionA,
    optionB: q.optionB,
    category: q.category
  };

  const select = document.getElementById("presetSelect");
  if (select) select.value = idx;

  updateRoundUI();
  updateQuestionPreview();
}

// 라운드 네비게이션 UI 업데이트
function updateRoundUI() {
  const roundBadge = document.getElementById("hostRoundBadge");
  const roundCategory = document.getElementById("hostRoundCategory");
  const btnStartText = document.getElementById("btnStartGameText");

  const currentNum = hostState.currentQuestionIndex + 1;
  const total = hostState.totalQuestions;

  if (roundBadge) roundBadge.textContent = `Q ${currentNum} / ${total}`;
  if (roundCategory && hostState.selectedQuestion) roundCategory.textContent = hostState.selectedQuestion.category || "밸런스 질문";
  if (btnStartText) btnStartText.textContent = `${currentNum}번 문제 시작`;
}

// 다음 문제로 이동
function goToNextQuestion() {
  if (hostState.status === "voting") {
    if (!confirm("현재 투표가 진행 중입니다. 다음 문제로 이동하시겠습니까?")) return;
    if (hostState.timerInterval) clearInterval(hostState.timerInterval);
  }
  if (hostState.currentQuestionIndex < hostState.totalQuestions - 1) {
    selectQuestionByIndex(hostState.currentQuestionIndex + 1);
  } else {
    alert("마지막 10번째 문제입니다.");
  }
}

// 이전 문제로 이동
function goToPreviousQuestion() {
  if (hostState.status === "voting") {
    if (!confirm("현재 투표가 진행 중입니다. 이전 문제로 이동하시겠습니까?")) return;
    if (hostState.timerInterval) clearInterval(hostState.timerInterval);
  }
  if (hostState.currentQuestionIndex > 0) {
    selectQuestionByIndex(hostState.currentQuestionIndex - 1);
  } else {
    alert("첫 번째 문제입니다.");
  }
}

// 프리셋 선택 변경 핸들러
function onSelectPresetQuestion() {
  const select = document.getElementById("presetSelect");
  selectQuestionByIndex(parseInt(select.value, 10) || 0);
}

// 직접 입력 vs 프리셋 탭 전환
function switchQuestionTab(tab) {
  const btnPreset = document.getElementById("btnTabPreset");
  const btnCustom = document.getElementById("btnTabCustom");
  const boxPreset = document.getElementById("presetQuestionBox");
  const boxCustom = document.getElementById("customQuestionBox");

  if (tab === "preset") {
    btnPreset.className = "px-3 py-1 rounded-lg bg-sky-600 text-white font-bold shadow-sm";
    btnCustom.className = "px-3 py-1 rounded-lg bg-slate-100 text-slate-600 font-medium hover:bg-slate-200";
    boxPreset.classList.remove("hidden");
    boxCustom.classList.add("hidden");
    onSelectPresetQuestion();
  } else {
    btnCustom.className = "px-3 py-1 rounded-lg bg-sky-600 text-white font-bold shadow-sm";
    btnPreset.className = "px-3 py-1 rounded-lg bg-slate-100 text-slate-600 font-medium hover:bg-slate-200";
    boxCustom.classList.remove("hidden");
    boxPreset.classList.add("hidden");

    const updateCustom = () => {
      hostState.selectedQuestion = {
        id: "custom_" + Date.now(),
        title: document.getElementById("customTitle").value || "직접 입력한 질문",
        optionA: document.getElementById("customOptionA").value || "선택지 A",
        optionB: document.getElementById("customOptionB").value || "선택지 B",
        category: "즉석 밸런스"
      };
      updateQuestionPreview();
    };

    document.getElementById("customTitle").oninput = updateCustom;
    document.getElementById("customOptionA").oninput = updateCustom;
    document.getElementById("customOptionB").oninput = updateCustom;
    updateCustom();
  }
}

// 미리보기 갱신
function updateQuestionPreview() {
  const q = hostState.selectedQuestion;
  if (!q) return;
  document.getElementById("previewTitle").textContent = q.title;
  document.getElementById("previewOptionA").textContent = q.optionA;
  document.getElementById("previewOptionB").textContent = q.optionB;
}

// 제한 시간(초) 설정
function setDuration(sec) {
  hostState.duration = sec;
  document.getElementById("customDurationInput").value = sec;
  document.querySelectorAll(".duration-btn").forEach((btn) => {
    btn.classList.remove("active", "bg-sky-600", "text-white", "font-bold", "shadow-sm");
    btn.classList.add("bg-slate-100", "text-slate-600", "font-medium");
  });
  if (event && event.target) {
    event.target.classList.add("active", "bg-sky-600", "text-white", "font-bold", "shadow-sm");
    event.target.classList.remove("bg-slate-100", "text-slate-600", "font-medium");
  }
}

document.getElementById("customDurationInput").addEventListener("change", (e) => {
  const val = parseInt(e.target.value, 10);
  if (!isNaN(val) && val >= 5) {
    hostState.duration = val;
  }
});

// 호스트 연결 상태 배지
function updateHostConnectionBadge() {
  const badge = document.getElementById("hostConnectionBadge");
  const cfg = getFirebaseConfig();

  if (db && cfg && cfg.apiKey) {
    badge.className = "px-3 py-1.5 text-xs rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5 font-medium shadow-sm";
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500"></span><span>Firebase (${cfg.projectId}) 연결됨</span>`;
  } else {
    badge.className = "px-3 py-1.5 text-xs rounded-xl bg-sky-50 text-sky-700 border border-sky-200 flex items-center gap-1.5 font-medium shadow-sm";
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-sky-500"></span><span>${cfg.projectId} (로컬 모드)</span>`;
  }
}

// 실시간 동기화 설정 (Firestore + BroadcastChannel)
function setupHostRealtimeListeners() {
  const channelName = `balance_room_${hostState.roomId}`;

  // 1. Local BroadcastChannel
  if (window.BroadcastChannel) {
    if (localBroadcast) localBroadcast.close();
    localBroadcast = new BroadcastChannel(channelName);
    localBroadcast.onmessage = (event) => {
      handleClientMessage(event.data);
    };
  }

  // 2. Firebase Cloud Firestore 실시간 리스너
  db = initFirebase();
  if (db) {
    if (participantsUnsubscribe) participantsUnsubscribe();
    if (votesUnsubscribe) votesUnsubscribe();

    const roomRef = db.collection("rooms").doc(hostState.roomId);

    // 참가자 서브컬렉션 감지
    participantsUnsubscribe = roomRef.collection("participants").onSnapshot((snapshot) => {
      hostState.connectedParticipants.clear();
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data && data.nickname && data.kicked !== true) {
          hostState.connectedParticipants.set(data.nickname, {
            nickname: data.nickname,
            joinedAt: data.lastActive || Date.now()
          });
        }
      });
      renderParticipantTags();
      updateLiveVoteGauge();
    }, (err) => console.warn("Firestore 참가자 리스너 경고:", err));

    // 투표 서브컬렉션 감지
    votesUnsubscribe = roomRef.collection("votes").onSnapshot((snapshot) => {
      hostState.roundVotes.clear();
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data && data.nickname && data.option) {
          hostState.roundVotes.set(data.nickname, {
            option: data.option,
            votedAt: data.votedAt || Date.now()
          });
        }
      });
      renderParticipantTags();
      updateLiveVoteGauge();
    }, (err) => console.warn("Firestore 투표 리스너 경고:", err));
  }
}

// 로컬 BroadcastChannel 메시지 수신 처리
function handleClientMessage(data) {
  if (!data) return;

  if (data.type === "JOIN" && data.nickname) {
    hostState.connectedParticipants.set(data.nickname, {
      nickname: data.nickname,
      joinedAt: data.timestamp || Date.now()
    });
    renderParticipantTags();
    updateLiveVoteGauge();
    return;
  }

  if (data.event === "VOTE" && data.nickname && data.option) {
    hostState.roundVotes.set(data.nickname, {
      option: data.option,
      votedAt: data.votedAt || Date.now()
    });
    renderParticipantTags();
    updateLiveVoteGauge();
  }
}

// [요구사항 1] 참가자 내보내기 (Kick) 로직
async function handleKickParticipant(nickname) {
  if (!confirm(`'${nickname}' 님을 방에서 내보내시겠습니까?`)) {
    return;
  }

  // 1. 로컬 상태 제거
  hostState.connectedParticipants.delete(nickname);
  hostState.roundVotes.delete(nickname);
  renderParticipantTags();
  updateLiveVoteGauge();

  // 2. Local Broadcast로 강퇴 알림 송신
  if (localBroadcast) {
    localBroadcast.postMessage({
      event: "KICK_USER",
      nickname: nickname
    });
  }

  // 3. Firestore 데이터베이스에 강퇴 기록
  if (db) {
    try {
      const roomRef = db.collection("rooms").doc(hostState.roomId);
      await roomRef.collection("participants").doc(nickname).set({
        kicked: true
      }, { merge: true });

      await roomRef.set({
        kickedUser: nickname,
        kickedAt: Date.now()
      }, { merge: true });
    } catch (err) {
      console.warn("강퇴 Firestore 처리 경고:", err);
    }
  }

  // 결과 테이블 갱신 (진행된 라운드가 있는 경우)
  const lastRound = hostState.historyRounds[hostState.historyRounds.length - 1];
  if (lastRound) {
    renderFilteredTable(lastRound.participantDetails);
  }

  alert(`'${nickname}' 님을 퇴장 처리했습니다.`);
}

// 접속자 태그 목록 렌더링 (내보내기 버튼 포함)
function renderParticipantTags() {
  const container = document.getElementById("participantTagsContainer");
  const countEl = document.getElementById("hostParticipantCount");
  const participants = Array.from(hostState.connectedParticipants.values());

  countEl.textContent = participants.length;

  if (participants.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-400">참가자가 접속하면 여기에 표시됩니다.</p>`;
    return;
  }

  container.innerHTML = "";
  participants.forEach((p) => {
    const hasVoted = hostState.roundVotes.has(p.nickname);
    const voteData = hostState.roundVotes.get(p.nickname);

    const tag = document.createElement("div");
    tag.className = "participant-tag";

    if (hasVoted) {
      const optColor = voteData.option === "A" ? "text-rose-600 font-bold" : "text-sky-600 font-bold";
      tag.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
        <span class="font-bold text-slate-800">${escapeHtml(p.nickname)}</span>
        <span class="text-xs ${optColor}">(${voteData.option})</span>
        <button onclick="handleKickParticipant('${escapeHtml(p.nickname)}')" class="btn-kick ml-1" title="퇴장시키기">✕</button>
      `;
    } else {
      tag.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-slate-300"></span>
        <span class="font-medium text-slate-600">${escapeHtml(p.nickname)}</span>
        <button onclick="handleKickParticipant('${escapeHtml(p.nickname)}')" class="btn-kick ml-1" title="퇴장시키기">✕</button>
      `;
    }
    container.appendChild(tag);
  });
}

// 실시간 투표 게이지 갱신
function updateLiveVoteGauge() {
  const total = hostState.connectedParticipants.size;
  const voted = hostState.roundVotes.size;
  const percent = total > 0 ? Math.min(100, Math.round((voted / total) * 100)) : 0;

  const votedEl = document.getElementById("liveVotedCount");
  const totalEl = document.getElementById("liveTotalCount");
  const gaugeEl = document.getElementById("liveProgressGauge");

  if (votedEl) votedEl.textContent = voted;
  if (totalEl) totalEl.textContent = total;
  if (gaugeEl) gaugeEl.style.width = `${percent}%`;
}

// 게임 시작
async function handleStartRound() {
  if (!hostState.selectedQuestion) {
    alert("질문을 먼저 선택해 주세요!");
    return;
  }

  hostState.status = "voting";
  hostState.startedAt = Date.now();
  hostState.roundVotes.clear();

  // UI 상태 변경
  const currentNum = hostState.currentQuestionIndex + 1;
  const total = hostState.totalQuestions;

  document.getElementById("gameStatusBadge").className = "px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 animate-pulse";
  document.getElementById("gameStatusBadge").textContent = `Q${currentNum}/${total} 투표 진행 중`;

  const btnStart = document.getElementById("btnStartGame");
  btnStart.disabled = true;
  btnStart.className = "sm:col-span-2 py-3 px-4 rounded-xl bg-slate-100 text-slate-400 font-bold text-sm border border-slate-200 cursor-not-allowed flex items-center justify-center gap-2";

  document.getElementById("btnStopTimer").disabled = false;
  document.getElementById("btnStopTimer").className = "py-3 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md shadow-rose-600/20 transition flex items-center justify-center gap-1.5 cursor-pointer";

  const finalBox = document.getElementById("finalAnnounceBox");
  if (finalBox) finalBox.classList.add("hidden");

  renderParticipantTags();
  updateLiveVoteGauge();

  const startPayload = {
    event: "START_ROUND",
    roundIndex: currentNum,
    totalRounds: total,
    question: hostState.selectedQuestion,
    duration: hostState.duration,
    startedAt: hostState.startedAt
  };

  // 1. Local Broadcast
  if (localBroadcast) {
    localBroadcast.postMessage({
      ...startPayload,
      payload: startPayload
    });
  }

  // 2. Firebase Cloud Firestore 방 상태 업데이트 (이전 투표 정리 포함)
  if (db) {
    try {
      // 기존 투표 서브컬렉션 정리
      const votesRef = db.collection("rooms").doc(hostState.roomId).collection("votes");
      const votesSnap = await votesRef.get();
      if (!votesSnap.empty) {
        const batch = db.batch();
        votesSnap.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
      }

      await db.collection("rooms").doc(hostState.roomId).set({
        status: "voting",
        roundIndex: currentNum,
        totalRounds: total,
        currentQuestion: hostState.selectedQuestion,
        duration: hostState.duration,
        startedAt: hostState.startedAt,
        resultSummary: null
      }, { merge: true });
    } catch (err) {
      console.warn("Firestore 방 업데이트 경고:", err);
    }
  }

  startHostCountdown();
}

// 카운트다운 타이머
function startHostCountdown() {
  if (hostState.timerInterval) clearInterval(hostState.timerInterval);

  const timerEl = document.getElementById("hostTimerText");

  const tick = () => {
    const elapsed = Math.floor((Date.now() - hostState.startedAt) / 1000);
    const remaining = Math.max(0, hostState.duration - elapsed);

    timerEl.textContent = `${remaining}s`;

    if (remaining <= 0) {
      clearInterval(hostState.timerInterval);
      hostState.timerInterval = null;
      calculateAndShowResults();
    }
  };

  tick();
  hostState.timerInterval = setInterval(tick, 200);
}

// 조기 마감
function handleStopTimer() {
  if (hostState.status !== "voting") return;
  if (hostState.timerInterval) {
    clearInterval(hostState.timerInterval);
    hostState.timerInterval = null;
  }
  calculateAndShowResults();
}

// 결과 집계 및 다수파/소수파 확정
async function calculateAndShowResults() {
  hostState.status = "result";

  const currentNum = hostState.currentQuestionIndex + 1;
  const total = hostState.totalQuestions;

  document.getElementById("gameStatusBadge").className = "px-2.5 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300";
  document.getElementById("gameStatusBadge").textContent = `Q${currentNum} 결과 발표 (Result)`;

  document.getElementById("btnStopTimer").disabled = true;
  document.getElementById("btnStopTimer").className = "py-3 px-3 rounded-xl bg-slate-100 text-slate-400 font-bold text-xs border border-slate-200 cursor-not-allowed flex items-center justify-center gap-1.5";

  document.getElementById("hostTimerText").textContent = "0s (마감)";

  let countA = 0;
  let countB = 0;

  hostState.roundVotes.forEach((vote) => {
    if (vote.option === "A") countA++;
    else if (vote.option === "B") countB++;
  });

  const totalVotes = countA + countB;
  let percentA = 0;
  let percentB = 0;
  let majorityOption = "NONE";

  if (totalVotes > 0) {
    percentA = Math.round((countA / totalVotes) * 100);
    percentB = 100 - percentA;

    if (countA > countB) majorityOption = "A";
    else if (countB > countA) majorityOption = "B";
    else majorityOption = "TIE";
  }

  // 참가자별 개별 판정 데이터 생성
  const participantDetails = [];
  const allUsers = new Set([
    ...Array.from(hostState.connectedParticipants.keys()),
    ...Array.from(hostState.roundVotes.keys())
  ]);

  allUsers.forEach((nickname) => {
    const vote = hostState.roundVotes.get(nickname);
    let choice = "NONE";
    let isMajority = null;
    let votedTimeStr = "-";

    if (vote) {
      choice = vote.option;
      votedTimeStr = new Date(vote.votedAt).toLocaleTimeString();
      if (majorityOption === "TIE") {
        isMajority = true;
      } else if (majorityOption === choice) {
        isMajority = true;
      } else {
        isMajority = false;
      }
    }

    participantDetails.push({
      nickname,
      choice,
      isMajority,
      votedAt: votedTimeStr
    });
  });

  const resultPayload = {
    event: "SHOW_RESULTS",
    roundIndex: currentNum,
    totalRounds: total,
    questionTitle: hostState.selectedQuestion.title,
    optionA: hostState.selectedQuestion.optionA,
    optionB: hostState.selectedQuestion.optionB,
    countA,
    countB,
    totalVotes,
    percentA,
    percentB,
    majorityOption,
    participantDetails
  };

  // 1. Local Broadcast
  if (localBroadcast) {
    localBroadcast.postMessage({
      ...resultPayload,
      payload: resultPayload
    });
  }

  // 2. Firebase Cloud Firestore 업데이트
  if (db) {
    try {
      await db.collection("rooms").doc(hostState.roomId).set({
        status: "result",
        roundIndex: currentNum,
        totalRounds: total,
        resultSummary: resultPayload
      }, { merge: true });
    } catch (err) {
      console.warn("Firestore 결과 업데이트 경고:", err);
    }
  }

  hostState.historyRounds.push({
    roundIndex: currentNum,
    question: { ...hostState.selectedQuestion },
    countA,
    countB,
    totalVotes,
    percentA,
    percentB,
    majorityOption,
    participantDetails
  });

  // 버튼 상태 업데이트 (순차 진행: 다음 문제 버튼 or 10문제 완료 발표 버튼)
  const nextRoundIndex = hostState.currentQuestionIndex + 1;
  const btnStart = document.getElementById("btnStartGame");
  const btnStartText = document.getElementById("btnStartGameText");
  const finalBox = document.getElementById("finalAnnounceBox");

  btnStart.disabled = false;
  btnStart.className = "sm:col-span-2 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-black text-sm shadow-md shadow-emerald-500/20 transition flex items-center justify-center gap-2 cursor-pointer";

  if (nextRoundIndex < hostState.totalQuestions) {
    if (btnStartText) btnStartText.textContent = `▶ 다음 문제 (${nextRoundIndex + 1}/10) 준비`;
    btnStart.onclick = () => {
      goToNextQuestion();
      btnStart.onclick = handleStartRound;
    };
    if (finalBox) finalBox.classList.add("hidden");
  } else {
    if (btnStartText) btnStartText.textContent = `🎉 10문제 완료 (최종 결과 발표)`;
    btnStart.onclick = () => {
      triggerFinalResults();
    };
    if (finalBox) finalBox.classList.remove("hidden");
  }

  renderIndividualResults(resultPayload);
  updateChartsAndRankings();
}

// [요구사항 4] 최종 10문제 완료 및 학교 대다수 일치율 발표 트리거
async function triggerFinalResults() {
  hostState.status = "final";

  const finalPayload = {
    event: "FINAL_RESULTS",
    totalRounds: hostState.historyRounds.length,
    historyRounds: hostState.historyRounds
  };

  if (localBroadcast) {
    localBroadcast.postMessage({
      ...finalPayload,
      payload: finalPayload
    });
  }

  if (db) {
    try {
      await db.collection("rooms").doc(hostState.roomId).set({
        status: "final",
        finalSummary: finalPayload
      }, { merge: true });
    } catch (err) {
      console.warn("Firestore 최종 결과 트리거 경고:", err);
    }
  }

  alert("참가자 화면에 [우리학교 대다수 일치율 및 최종 점수] 결과 화면이 발표되었습니다! 🎉");
}

// 개별 참가자 선택 내역 테이블 렌더링
function renderIndividualResults(summary) {
  document.getElementById("hostResultOptionA").textContent = summary.optionA;
  document.getElementById("hostResultCountA").textContent = `${summary.countA}표`;
  document.getElementById("hostResultPercentA").textContent = `${summary.percentA}%`;

  document.getElementById("hostResultOptionB").textContent = summary.optionB;
  document.getElementById("hostResultCountB").textContent = `${summary.countB}표`;
  document.getElementById("hostResultPercentB").textContent = `${summary.percentB}%`;

  const list = summary.participantDetails;
  const countALL = list.length;
  const countA = list.filter((p) => p.choice === "A").length;
  const countB = list.filter((p) => p.choice === "B").length;
  const countNONE = list.filter((p) => p.choice === "NONE").length;

  document.getElementById("filterCountALL").textContent = countALL;
  document.getElementById("filterCountA").textContent = countA;
  document.getElementById("filterCountB").textContent = countB;
  document.getElementById("filterCountNONE").textContent = countNONE;

  renderFilteredTable(list);
}

// 필터링 적용 렌더링 (내보내기 버튼 포함)
function renderFilteredTable(list) {
  const tbody = document.getElementById("participantResultTableBody");
  tbody.innerHTML = "";

  const filtered = list.filter((p) => {
    if (hostState.currentFilter === "ALL") return true;
    return p.choice === hostState.currentFilter;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="px-4 py-8 text-center text-slate-400 text-xs">
          해당 조건에 일치하는 참가자가 없습니다.
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach((p, idx) => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-50 transition";

    let choiceBadge = "";
    let choiceText = "";
    let verdictBadge = "";

    if (p.choice === "A") {
      choiceBadge = `<span class="px-2.5 py-0.5 rounded-full text-xs font-black bg-rose-100 text-rose-700 border border-rose-200">선택지 A</span>`;
      choiceText = hostState.selectedQuestion.optionA;
    } else if (p.choice === "B") {
      choiceBadge = `<span class="px-2.5 py-0.5 rounded-full text-xs font-black bg-sky-100 text-sky-700 border border-sky-200">선택지 B</span>`;
      choiceText = hostState.selectedQuestion.optionB;
    } else {
      choiceBadge = `<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-500 border border-slate-200">미투표</span>`;
      choiceText = "-";
      verdictBadge = `<span class="text-xs text-slate-400 font-medium">시간 초과</span>`;
    }

    if (p.isMajority === true) {
      verdictBadge = `<span class="px-2 py-0.5 rounded-md text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 flex items-center gap-1 w-max shadow-sm">👑 다수파</span>`;
    } else if (p.isMajority === false) {
      verdictBadge = `<span class="px-2 py-0.5 rounded-md text-xs font-bold bg-purple-100 text-purple-800 border border-purple-200 flex items-center gap-1 w-max shadow-sm">⚡ 소수파</span>`;
    }

    tr.innerHTML = `
      <td class="px-4 py-3 font-mono text-xs text-slate-400">${idx + 1}</td>
      <td class="px-4 py-3 font-bold text-slate-900 flex items-center gap-2">
        <span>👤</span>
        <span>${escapeHtml(p.nickname)}</span>
      </td>
      <td class="px-4 py-3">${choiceBadge}</td>
      <td class="px-4 py-3 text-xs text-slate-600 max-w-[200px] truncate" title="${escapeHtml(choiceText)}">${escapeHtml(choiceText)}</td>
      <td class="px-4 py-3">${verdictBadge}</td>
      <td class="px-4 py-3 font-mono text-xs text-slate-500">${p.votedAt}</td>
      <td class="px-4 py-3 text-right">
        <button onclick="handleKickParticipant('${escapeHtml(p.nickname)}')" class="px-2 py-0.5 rounded text-xs bg-rose-50 text-rose-600 hover:bg-rose-100 font-semibold border border-rose-200 transition">
          내보내기
        </button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// 명단 필터 변경
function filterParticipantList(filter) {
  hostState.currentFilter = filter;
  ["ALL", "A", "B", "NONE"].forEach((f) => {
    const btn = document.getElementById(`filterBtn${f}`);
    if (f === filter) {
      btn.className = "px-3 py-1.5 rounded-lg bg-sky-600 text-white font-bold shadow-sm";
    } else {
      btn.className = "px-3 py-1.5 rounded-lg text-slate-600 hover:bg-white font-semibold";
    }
  });

  const lastRound = hostState.historyRounds[hostState.historyRounds.length - 1];
  if (lastRound) {
    renderFilteredTable(lastRound.participantDetails);
  }
}

// 라운드 대기 초기화
async function handleResetRound() {
  if (hostState.timerInterval) {
    clearInterval(hostState.timerInterval);
    hostState.timerInterval = null;
  }

  hostState.status = "waiting";
  hostState.roundVotes.clear();

  document.getElementById("gameStatusBadge").className = "px-2.5 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-600 border border-slate-200";
  document.getElementById("gameStatusBadge").textContent = "대기 중 (Waiting)";

  const btnStart = document.getElementById("btnStartGame");
  const btnStartText = document.getElementById("btnStartGameText");
  btnStart.disabled = false;
  btnStart.className = "sm:col-span-2 py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-black text-sm shadow-md shadow-emerald-500/20 transition flex items-center justify-center gap-2 cursor-pointer";
  btnStart.onclick = handleStartRound;
  if (btnStartText) btnStartText.textContent = `${hostState.currentQuestionIndex + 1}번 문제 시작`;

  document.getElementById("btnStopTimer").disabled = true;
  document.getElementById("btnStopTimer").className = "py-3 px-3 rounded-xl bg-slate-100 text-slate-400 font-bold text-xs border border-slate-200 cursor-not-allowed flex items-center justify-center gap-1.5";

  document.getElementById("hostTimerText").textContent = "--s";
  const finalBox = document.getElementById("finalAnnounceBox");
  if (finalBox) finalBox.classList.add("hidden");

  renderParticipantTags();
  updateLiveVoteGauge();

  const resetPayload = {
    event: "RESET_ROUND",
    roundIndex: hostState.currentQuestionIndex + 1,
    totalRounds: hostState.totalQuestions
  };

  if (localBroadcast) {
    localBroadcast.postMessage({
      ...resetPayload,
      payload: resetPayload
    });
  }
  if (db) {
    try {
      await db.collection("rooms").doc(hostState.roomId).set({
        status: "waiting",
        resultSummary: null
      }, { merge: true });
    } catch (e) {}
  }
}

// Chart.js 초기화 (Light Mode 테마)
function initCharts() {
  const ctxDonut = document.getElementById("voteDonutChart").getContext("2d");
  hostState.donutChart = new Chart(ctxDonut, {
    type: "doughnut",
    data: {
      labels: ["A 선택", "B 선택"],
      datasets: [
        {
          data: [0, 0],
          backgroundColor: ["#f43f5e", "#0284c7"],
          borderWidth: 2,
          borderColor: "#ffffff"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: "#475569", font: { size: 11, weight: 'bold' } },
          position: "bottom"
        }
      },
      cutout: "68%"
    }
  });

  const ctxBar = document.getElementById("historyBarChart").getContext("2d");
  hostState.historyBarChart = new Chart(ctxBar, {
    type: "bar",
    data: {
      labels: [],
      datasets: [
        {
          label: "A 선택표",
          data: [],
          backgroundColor: "#f43f5e"
        },
        {
          label: "B 선택표",
          data: [],
          backgroundColor: "#0284c7"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { color: "#64748b", font: { size: 10 } },
          grid: { color: "rgba(0,0,0,0.04)" }
        },
        y: {
          beginAtZero: true,
          ticks: { color: "#64748b", font: { size: 10 }, stepSize: 1 },
          grid: { color: "rgba(0,0,0,0.04)" }
        }
      },
      plugins: {
        legend: {
          labels: { color: "#475569", font: { size: 11, weight: 'bold' } },
          position: "bottom"
        }
      }
    }
  });
}

// 차트 및 다수파 랭킹 갱신
function updateChartsAndRankings() {
  const lastRound = hostState.historyRounds[hostState.historyRounds.length - 1];
  if (!lastRound) return;

  if (hostState.donutChart) {
    hostState.donutChart.data.datasets[0].data = [lastRound.countA, lastRound.countB];
    hostState.donutChart.update();
  }

  if (hostState.historyBarChart) {
    hostState.historyBarChart.data.labels = hostState.historyRounds.map((r) => `R${r.roundIndex}`);
    hostState.historyBarChart.data.datasets[0].data = hostState.historyRounds.map((r) => r.countA);
    hostState.historyBarChart.data.datasets[1].data = hostState.historyRounds.map((r) => r.countB);
    hostState.historyBarChart.update();
  }

  const userStats = new Map();

  hostState.historyRounds.forEach((r) => {
    r.participantDetails.forEach((p) => {
      if (p.choice !== "NONE") {
        if (!userStats.has(p.nickname)) {
          userStats.set(p.nickname, { total: 0, majorityWins: 0 });
        }
        const s = userStats.get(p.nickname);
        s.total += 1;
        if (p.isMajority) {
          s.majorityWins += 1;
        }
      }
    });
  });

  const rankList = Array.from(userStats.entries()).map(([nickname, s]) => {
    const rate = Math.round((s.majorityWins / s.total) * 100);
    return { nickname, total: s.total, wins: s.majorityWins, rate };
  });

  rankList.sort((a, b) => b.rate - a.rate || b.wins - a.wins);

  const container = document.getElementById("majorityRankList");
  container.innerHTML = "";

  if (rankList.length === 0) {
    container.innerHTML = `<p class="text-slate-400">참가자 투표가 쌓이면 순위가 표시됩니다.</p>`;
    return;
  }

  rankList.forEach((item, idx) => {
    const div = document.createElement("div");
    div.className = "flex justify-between items-center p-2 rounded-lg bg-slate-50 border border-slate-200 text-xs";
    let rankBadge = `${idx + 1}위`;
    if (idx === 0) rankBadge = "🥇 1위";
    else if (idx === 1) rankBadge = "🥈 2위";
    else if (idx === 2) rankBadge = "🥉 3위";

    div.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="font-bold text-slate-700">${rankBadge}</span>
        <span class="text-slate-900 font-bold">${escapeHtml(item.nickname)}</span>
      </div>
      <div class="text-right">
        <span class="text-emerald-700 font-black font-mono">${item.rate}%</span>
        <span class="text-slate-400 text-[10px]">(${item.wins}/${item.total}회 다수파)</span>
      </div>
    `;
    container.appendChild(div);
  });
}

// 통계 CSV 다운로드
function exportStatsCSV() {
  if (hostState.historyRounds.length === 0) {
    alert("아직 진행된 라운드가 없습니다. 먼저 게임을 진행해 주세요!");
    return;
  }

  let csv = "\uFEFF";
  csv += "라운드,질문,선택지A,선택지B,참가자닉네임,선택한항목,선택지내용,판정결과,투표시간\n";

  hostState.historyRounds.forEach((r) => {
    r.participantDetails.forEach((p) => {
      const choiceContent = p.choice === "A" ? r.question.optionA : (p.choice === "B" ? r.question.optionB : "-");
      const verdict = p.isMajority === true ? "다수파" : (p.isMajority === false ? "소수파" : "미투표");
      csv += `"${r.roundIndex}","${r.question.title}","${r.question.optionA}","${r.question.optionB}","${p.nickname}","${p.choice}","${choiceContent}","${verdict}","${p.votedAt}"\n`;
    });
  });

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `balance_game_statistics_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

// 설정 모달
function openConfigModal() {
  document.getElementById("cfgHostPin").value = getHostPin();
  document.getElementById("cfgRoomInput").value = hostState.roomId;
  document.getElementById("configModal").classList.remove("hidden");
}

function closeConfigModal() {
  document.getElementById("configModal").classList.add("hidden");
}

function saveHostConfigModal() {
  const newPin = document.getElementById("cfgHostPin").value.trim() || "1234";
  const room = document.getElementById("cfgRoomInput").value.trim() || "default";

  localStorage.setItem("balance_host_pin", newPin);
  hostState.roomId = room;
  document.getElementById("displayRoomCode").textContent = room;

  closeConfigModal();
  alert("설정이 저장되었습니다!");
}
