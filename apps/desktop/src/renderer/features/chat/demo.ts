export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
}
export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
}
export const createConversation = (): Conversation => ({
  id: crypto.randomUUID(),
  title: "새 대화",
  messages: [],
});
export function demoReply(text: string): string {
  if (/안녕|반가/.test(text))
    return "안녕하세요! 이곳에서 대화를 시작하고 작업 아이디어를 정리해 보세요. 지금은 미리 정해진 로컬 데모 응답을 보여 드리고 있어요.";
  if (/계획|할 일|일정/.test(text))
    return "작업 계획을 이렇게 나누어 보세요.\n\n1. 오늘 마무리할 목표를 한 문장으로 적기\n2. 필요한 작업을 작은 단위로 나누기\n3. 우선순위와 완료 기준 정하기\n\n이 답변은 입력 키워드에 따른 데모 예시입니다.";
  if (/기능|도움|무엇/.test(text))
    return "새 대화를 만들고 대화 목록을 오갈 수 있어요. 설정에서는 라이트·다크·시스템 테마를 선택할 수 있습니다.\n\nAI 모드의 완료된 메시지는 내 계정에 저장됩니다. 현재 선택한 데모 모드의 메시지는 로그아웃하거나 앱을 닫으면 사라집니다. 이 답변은 데모이며 실제 AI 호출은 없습니다.";
  return `“${text.slice(0, 120)}${text.length > 120 ? "…" : ""}”에 관한 메시지를 받았어요.\n\n이 답변은 화면을 체험하기 위한 로컬 데모입니다. 실제 AI 분석이나 외부 서비스 호출은 수행하지 않습니다.`;
}
