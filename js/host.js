// ============================================================================
// 진행자(Host) 콘솔 로직 (host.js)
// Google Firebase (Cloud Firestore) 실시간 제어, 개별 선택 확인, Chart.js 통계
// ============================================================================

let db = null;
let participantsUnsubscribe = null;
let votesUnsubscribe = null;
let localBroadcast = null;

// 진행자 상태 객체
const hostState = {
  roomId: "default",
  status: "waiting", // 'waiting' | 'voting' | 'result'
  duration: 15,
  startedAt: null,
  timerInterval: null,
  selectedQuestion: null,
  
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

// 페이지 로드 시 초기화
window.addEventListener("DOMContentLoaded", () => {
  hostState.roomId = getRoomId();
  document.getElementById("displayRoomCode").textContent = hostState.roomId;
  document.getElementById("cfgRoomInput").value = hostState.roomId;

  initQuestionPresets();

  db = initFirebase();
  updateHostConnectionBadge();
  setupHostRealtimeListeners();
  initCharts();
});

// 프리셋 드롭다운 초기화
function initQuestionPresets() {
  const select = document.getElementById("presetSelect");
  select.innerHTML = "";

  DEFAULT_QUESTIONS.forEach((q, idx) => {
    const opt = document.createElement("option");
    opt.value = idx;
    opt.textContent = `[${q.category}] ${q.title}`;
    select.appendChild(opt);
  });

  onSelectPresetQuestion();
}

// 프리셋 선택 변경 핸들러
function onSelectPresetQuestion() {
  const select = document.getElementById("presetSelect");
  const q = DEFAULT_QUESTIONS[select.value];
  if (!q) return;

  hostState.selectedQuestion = {
    id: q.id,
    title: q.title,
    optionA: q.optionA,
    optionB: q.optionB,
    category: q.category
  };

  updateQuestionPreview();
}

// 직접 입력 vs 프리셋 탭 전환
function switchQuestionTab(tab) {
  const btnPreset = document.getElementById("btnTabPreset");
  const btnCustom = document.getElementById("btnTabCustom");
  const boxPreset = document.getElementById("presetQuestionBox");
  const boxCustom = document.getElementById("customQuestionBox");

  if (tab === "preset") {
    btnPreset.className = "px-3 py-1 rounded-lg bg-sky-500 text-white font-semibold";
    btnCustom.className = "px-3 py-1 rounded-lg bg-slate-800 text-slate-400 font-semibold hover:text-white";
    boxPreset.classList.remove("hidden");
    boxCustom.classList.add("hidden");
    onSelectPresetQuestion();
  } else {
    btnCustom.className = "px-3 py-1 rounded-lg bg-sky-500 text-white font-semibold";
    btnPreset.className = "px-3 py-1 rounded-lg bg-slate-800 text-slate-400 font-semibold hover:text-white";
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
    btn.classList.remove("active", "bg-sky-500", "text-white", "font-bold");
    btn.classList.add("bg-slate-800", "text-slate-300");
  });
  if (event && event.target) {
    event.target.classList.add("active", "bg-sky-500", "text-white", "font-bold");
    event.target.classList.remove("bg-slate-800", "text-slate-300");
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
    badge.className = "px-3 py-1.5 text-xs rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5";
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400"></span><span>Firebase (${cfg.projectId}) 연결됨</span>`;
  } else {
    badge.className = "px-3 py-1.5 text-xs rounded-xl bg-sky-500/20 text-sky-400 border border-sky-500/30 flex items-center gap-1.5";
    badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-sky-400"></span><span>${cfg.projectId} (로컬 모드)</span>`;
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

    // 참가자 서브컬렉션 실시간 감지
    participantsUnsubscribe = roomRef.collection("participants").onSnapshot((snapshot) => {
      snapshot.forEach((doc) => {
        const data = doc.data();
        if (data && data.nickname) {
          if (!hostState.connectedParticipants.has(data.nickname)) {
            hostState.connectedParticipants.set(data.nickname, {
              nickname: data.nickname,
              joinedAt: data.lastActive || Date.now()
            });
          }
        }
      });
      renderParticipantTags();
    }, (err) => console.warn("Firestore 참가자 리스너 경고:", err));

    // 투표 서브컬렉션 실시간 감지
    votesUnsubscribe = roomRef.collection("votes").onSnapshot((snapshot) => {
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

// 접속자 태그 목록 렌더링
function renderParticipantTags() {
  const container = document.getElementById("participantTagsContainer");
  const countEl = document.getElementById("hostParticipantCount");
  const participants = Array.from(hostState.connectedParticipants.values());

  countEl.textContent = participants.length;

  if (participants.length === 0) {
    container.innerHTML = `<p class="text-xs text-slate-500">참가자가 접속하면 여기에 표시됩니다.</p>`;
    return;
  }

  container.innerHTML = "";
  participants.forEach((p) => {
    const hasVoted = hostState.roundVotes.has(p.nickname);
    const voteData = hostState.roundVotes.get(p.nickname);

    const tag = document.createElement("div");
    tag.className = "participant-tag";

    if (hasVoted) {
      const optColor = voteData.option === "A" ? "text-rose-400" : "text-sky-400";
      tag.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
        <span class="font-medium text-slate-200">${escapeHtml(p.nickname)}</span>
        <span class="text-xs font-bold ${optColor}">(${voteData.option})</span>
      `;
    } else {
      tag.innerHTML = `
        <span class="w-2 h-2 rounded-full bg-slate-500"></span>
        <span class="font-medium text-slate-400">${escapeHtml(p.nickname)}</span>
      `;
    }
    container.appendChild(tag);
  });
}

// 실시간 투표 게이지 갱신
function updateLiveVoteGauge() {
  const total = hostState.connectedParticipants.size || 1;
  const voted = hostState.roundVotes.size;
  const percent = Math.min(100, Math.round((voted / total) * 100));

  document.getElementById("liveVotedCount").textContent = voted;
  document.getElementById("liveTotalCount").textContent = total;
  document.getElementById("liveProgressGauge").style.width = `${percent}%`;
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
  document.getElementById("gameStatusBadge").className = "px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse";
  document.getElementById("gameStatusBadge").textContent = "투표 진행 중 (Voting)";

  document.getElementById("btnStartGame").disabled = true;
  document.getElementById("btnStartGame").className = "py-3 px-4 rounded-xl bg-slate-800 text-slate-500 font-bold text-sm border border-slate-700 cursor-not-allowed flex items-center justify-center gap-2";

  document.getElementById("btnStopTimer").disabled = false;
  document.getElementById("btnStopTimer").className = "py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm shadow-lg shadow-rose-600/20 transition flex items-center justify-center gap-2 cursor-pointer";

  renderParticipantTags();
  updateLiveVoteGauge();

  const startPayload = {
    event: "START_ROUND",
    question: hostState.selectedQuestion,
    duration: hostState.duration,
    startedAt: hostState.startedAt
  };

  // 1. Local Broadcast
  if (localBroadcast) {
    localBroadcast.postMessage(startPayload);
  }

  // 2. Firebase Cloud Firestore 방 상태 업데이트
  if (db) {
    try {
      await db.collection("rooms").doc(hostState.roomId).set({
        status: "voting",
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

  document.getElementById("gameStatusBadge").className = "px-2.5 py-1 rounded-full text-xs font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30";
  document.getElementById("gameStatusBadge").textContent = "결과 발표 (Result)";

  document.getElementById("btnStartGame").disabled = false;
  document.getElementById("btnStartGame").className = "py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold text-sm shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2 cursor-pointer";

  document.getElementById("btnStopTimer").disabled = true;
  document.getElementById("btnStopTimer").className = "py-3 px-4 rounded-xl bg-slate-800 text-slate-500 font-bold text-sm border border-slate-700 cursor-not-allowed flex items-center justify-center gap-2";

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
    localBroadcast.postMessage(resultPayload);
  }

  // 2. Firebase Cloud Firestore 업데이트
  if (db) {
    try {
      await db.collection("rooms").doc(hostState.roomId).set({
        status: "result",
        resultSummary: resultPayload
      }, { merge: true });
    } catch (err) {
      console.warn("Firestore 결과 업데이트 경고:", err);
    }
  }

  // 이번 라운드 기록 보관
  hostState.historyRounds.push({
    roundIndex: hostState.historyRounds.length + 1,
    question: { ...hostState.selectedQuestion },
    countA,
    countB,
    totalVotes,
    percentA,
    percentB,
    majorityOption,
    participantDetails
  });

  renderIndividualResults(resultPayload);
  updateChartsAndRankings();
}

// [핵심 요구사항 3] 개별 참가자 선택 내역 테이블 렌더링
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

// 필터링 적용 렌더링
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
        <td colspan="6" class="px-4 py-8 text-center text-slate-500 text-xs">
          해당 조건에 일치하는 참가자가 없습니다.
        </td>
      </tr>
    `;
    return;
  }

  filtered.forEach((p, idx) => {
    const tr = document.createElement("tr");
    tr.className = "hover:bg-slate-800/40 transition";

    let choiceBadge = "";
    let choiceText = "";
    let verdictBadge = "";

    if (p.choice === "A") {
      choiceBadge = `<span class="px-2.5 py-1 rounded-full text-xs font-black bg-rose-500/20 text-rose-400 border border-rose-500/30">선택지 A</span>`;
      choiceText = hostState.selectedQuestion.optionA;
    } else if (p.choice === "B") {
      choiceBadge = `<span class="px-2.5 py-1 rounded-full text-xs font-black bg-sky-500/20 text-sky-400 border border-sky-500/30">선택지 B</span>`;
      choiceText = hostState.selectedQuestion.optionB;
    } else {
      choiceBadge = `<span class="px-2.5 py-1 rounded-full text-xs font-bold bg-slate-700 text-slate-400">미투표</span>`;
      choiceText = "-";
      verdictBadge = `<span class="text-xs text-slate-500">시간 초과</span>`;
    }

    if (p.isMajority === true) {
      verdictBadge = `<span class="px-2 py-0.5 rounded-md text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1 w-max">👑 다수파</span>`;
    } else if (p.isMajority === false) {
      verdictBadge = `<span class="px-2 py-0.5 rounded-md text-xs font-bold bg-purple-500/20 text-purple-400 border border-purple-500/30 flex items-center gap-1 w-max">⚡ 소수파</span>`;
    }

    tr.innerHTML = `
      <td class="px-4 py-3 font-mono text-xs text-slate-500">${idx + 1}</td>
      <td class="px-4 py-3 font-bold text-white flex items-center gap-2">
        <span>👤</span>
        <span>${escapeHtml(p.nickname)}</span>
      </td>
      <td class="px-4 py-3">${choiceBadge}</td>
      <td class="px-4 py-3 text-xs text-slate-300 max-w-[200px] truncate" title="${escapeHtml(choiceText)}">${escapeHtml(choiceText)}</td>
      <td class="px-4 py-3">${verdictBadge}</td>
      <td class="px-4 py-3 font-mono text-xs text-slate-400">${p.votedAt}</td>
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
      btn.className = "px-3 py-1.5 rounded-lg bg-sky-500 text-white font-semibold";
    } else {
      btn.className = "px-3 py-1.5 rounded-lg text-slate-400 hover:bg-slate-800";
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

  document.getElementById("gameStatusBadge").className = "px-2.5 py-1 rounded-full text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700";
  document.getElementById("gameStatusBadge").textContent = "대기 중 (Waiting)";

  document.getElementById("btnStartGame").disabled = false;
  document.getElementById("btnStartGame").className = "py-3 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-bold text-sm shadow-lg shadow-emerald-500/20 transition flex items-center justify-center gap-2 cursor-pointer";

  document.getElementById("btnStopTimer").disabled = true;
  document.getElementById("btnStopTimer").className = "py-3 px-4 rounded-xl bg-slate-800 text-slate-500 font-bold text-sm border border-slate-700 cursor-not-allowed flex items-center justify-center gap-2";

  document.getElementById("hostTimerText").textContent = "--s";

  renderParticipantTags();
  updateLiveVoteGauge();

  const resetPayload = { event: "RESET_ROUND" };

  if (localBroadcast) localBroadcast.postMessage(resetPayload);
  if (db) {
    try {
      await db.collection("rooms").doc(hostState.roomId).set({
        status: "waiting",
        resultSummary: null
      }, { merge: true });
    } catch (e) {}
  }
}

// Chart.js 초기화
function initCharts() {
  const ctxDonut = document.getElementById("voteDonutChart").getContext("2d");
  hostState.donutChart = new Chart(ctxDonut, {
    type: "doughnut",
    data: {
      labels: ["A 선택", "B 선택"],
      datasets: [
        {
          data: [0, 0],
          backgroundColor: ["#f43f5e", "#0ea5e9"],
          borderWidth: 2,
          borderColor: "#0f172a"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: "#94a3b8", font: { size: 11 } },
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
          backgroundColor: "#0ea5e9"
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: { color: "#94a3b8", font: { size: 10 } },
          grid: { color: "rgba(255,255,255,0.05)" }
        },
        y: {
          beginAtZero: true,
          ticks: { color: "#94a3b8", font: { size: 10 }, stepSize: 1 },
          grid: { color: "rgba(255,255,255,0.05)" }
        }
      },
      plugins: {
        legend: {
          labels: { color: "#94a3b8", font: { size: 11 } },
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
    container.innerHTML = `<p class="text-slate-500">참가자 투표가 쌓이면 순위가 표시됩니다.</p>`;
    return;
  }

  rankList.forEach((item, idx) => {
    const div = document.createElement("div");
    div.className = "flex justify-between items-center p-2 rounded-lg bg-slate-800/60 text-xs";
    let rankBadge = `${idx + 1}위`;
    if (idx === 0) rankBadge = "🥇 1위";
    else if (idx === 1) rankBadge = "🥈 2위";
    else if (idx === 2) rankBadge = "🥉 3위";

    div.innerHTML = `
      <div class="flex items-center gap-2">
        <span class="font-bold text-slate-300">${rankBadge}</span>
        <span class="text-white font-medium">${escapeHtml(item.nickname)}</span>
      </div>
      <div class="text-right">
        <span class="text-emerald-400 font-bold font-mono">${item.rate}%</span>
        <span class="text-slate-500 text-[10px]">(${item.wins}/${item.total}회 다수파)</span>
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
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

  if (projectId) {
    alert("Firebase 설정 코드가 성공적으로 자동 분석되었습니다!");
  }
}

function openConfigModal() {
  const cfg = getFirebaseConfig();
  document.getElementById("cfgProjectId").value = cfg.projectId || "";
  document.getElementById("cfgApiKey").value = cfg.apiKey || "";
  document.getElementById("cfgRoomInput").value = hostState.roomId;
  document.getElementById("configModal").classList.remove("hidden");
}

function closeConfigModal() {
  document.getElementById("configModal").classList.add("hidden");
}

function saveConfigModal() {
  const projectId = document.getElementById("cfgProjectId").value.trim();
  const apiKey = document.getElementById("cfgApiKey").value.trim();
  const room = document.getElementById("cfgRoomInput").value.trim() || "default";

  if (!projectId) {
    alert("Project ID는 필수입니다!");
    return;
  }

  const newConfig = {
    apiKey,
    projectId,
    authDomain: `${projectId}.firebaseapp.com`
  };

  saveFirebaseConfig(newConfig, room);
  hostState.roomId = room;
  document.getElementById("displayRoomCode").textContent = room;

  closeConfigModal();
  db = initFirebase();
  updateHostConnectionBadge();
  setupHostRealtimeListeners();
  alert("Firebase 및 방 설정이 저장되었습니다!");
}
