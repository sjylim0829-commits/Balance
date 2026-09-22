// 기본 밸런스 게임 질문 프리셋 (Supabase 연동 전/후 모두 활용 가능)
const DEFAULT_QUESTIONS = [
  {
    id: "q1",
    title: "평생 한 가지만 먹어야 한다면?",
    optionA: "평생 삼시세끼 치킨만 먹기 🍗",
    optionB: "평생 삼시세끼 피자만 먹기 🍕",
    category: "음식"
  },
  {
    id: "q2",
    title: "여름 vs 겨울 극한의 환경",
    optionA: "에어컨 없는 한여름 40도 버티기 ☀️",
    optionB: "난방 없는 한겨울 영하 20도 버티기 ❄️",
    category: "일상"
  },
  {
    id: "q3",
    title: "시간 여행의 기회가 온다면?",
    optionA: "5억 받고 10년 전 과거로 가기 ⏳",
    optionB: "50억 받고 10년 후 미래로 가기 🚀",
    category: "초능력"
  },
  {
    id: "q4",
    title: "신체 초능력 하나를 얻는다면?",
    optionA: "잠을 전혀 안 자도 늘 100% 활력 ⚡",
    optionB: "아무리 기름진 걸 먹어도 살 절대 안 찜 🍔",
    category: "초능력"
  },
  {
    id: "q5",
    title: "직장인 극과 극 밸런스",
    optionA: "월 250만원 평생 백수 (생활비 보장) 🏖️",
    optionB: "월 800만원 매일 밤 11시 야근 대기업 💼",
    category: "직장"
  },
  {
    id: "q6",
    title: "평생 둘 중 하나를 포기해야 한다면?",
    optionA: "평생 스마트폰 없이 살기 📱",
    optionB: "평생 친구 없이 살기 👥",
    category: "일상"
  },
  {
    id: "q7",
    title: "치명적인 내 비밀이 공개된다면?",
    optionA: "학창시절 모든 흑역사 전 국민 생중계 📺",
    optionB: "인터넷/유튜브 검색기록 부모님께 공개 🔍",
    category: "공포"
  },
  {
    id: "q8",
    title: "부와 인간관계의 딜레마",
    optionA: "모두에게 사랑받지만 전재산 10만원 ❤️",
    optionB: "모두에게 손가락질받지만 1000억 부자 💰",
    category: "인생"
  },
  {
    id: "q9",
    title: "초능력 선택",
    optionA: "내 눈앞 1분 뒤 미래 보기 🔮",
    optionB: "10년 전 나에게 1분간 전화 통화하기 📞",
    category: "초능력"
  },
  {
    id: "q10",
    title: "평생 탄산 vs 평생 라면",
    optionA: "평생 탄산음료 절대 못 마시기 🥤",
    optionB: "평생 라면 절대 못 먹기 🍜",
    category: "음식"
  }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { DEFAULT_QUESTIONS };
}
