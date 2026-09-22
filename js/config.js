// ============================================================================
// Firebase 환경 설정 (Firebase Configuration)
// 프로젝트: balance-efed2
// ============================================================================

const DEFAULT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyChpjB1Msu1kamqjBkGm8x8pripdVN2lcM",
  authDomain: "balance-efed2.firebaseapp.com",
  projectId: "balance-efed2",
  storageBucket: "balance-efed2.firebasestorage.app",
  messagingSenderId: "499413513074",
  appId: "1:499413513074:web:dcd2eb824b9db62dc5e3eb",
  measurementId: "G-ZDRY5HY07X"
};

const APP_CONFIG = {
  DEFAULT_ROOM_ID: "default",
  HOST_PIN: "1234"
};

// 로컬 스토리지에 저장된 설정 로드 (기본값: DEFAULT_FIREBASE_CONFIG)
function getFirebaseConfig() {
  const savedJson = localStorage.getItem("balance_firebase_config");
  if (savedJson) {
    try {
      const parsed = JSON.parse(savedJson);
      if (parsed && parsed.projectId) {
        return {
          ...DEFAULT_FIREBASE_CONFIG,
          ...parsed
        };
      }
    } catch (e) {}
  }
  return DEFAULT_FIREBASE_CONFIG;
}

// 룸 ID 로드
function getRoomId() {
  return localStorage.getItem("balance_room_id") || APP_CONFIG.DEFAULT_ROOM_ID;
}

// Firebase 설정 저장 함수
function saveFirebaseConfig(configObj, roomId) {
  if (configObj && typeof configObj === "object") {
    const merged = {
      ...DEFAULT_FIREBASE_CONFIG,
      ...configObj
    };
    localStorage.setItem("balance_firebase_config", JSON.stringify(merged));
  }
  if (roomId) {
    localStorage.setItem("balance_room_id", roomId.trim());
  }
}

// Firebase & Cloud Firestore 초기화 함수
function initFirebase() {
  const cfg = getFirebaseConfig();
  if (!cfg || !cfg.projectId || !cfg.apiKey) {
    return null;
  }

  try {
    if (window.firebase) {
      if (window.firebase.apps && window.firebase.apps.length > 0) {
        return window.firebase.firestore();
      }
      const app = window.firebase.initializeApp(cfg);
      const db = window.firebase.firestore(app);
      return db;
    }
  } catch (err) {
    console.error("Firebase 초기화 에러:", err);
  }
  return null;
}

// HTML 특수문자 이스케이프 유틸리티
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
