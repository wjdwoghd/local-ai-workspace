export const REASONING_LEVELS=[
  {id:'low',label:'Light'}, {id:'medium',label:'Medium'}, {id:'high',label:'High'},
  {id:'xhigh',label:'Extra High'}, {id:'max',label:'Max'}, {id:'ultra',label:'Ultra'},
] as const;
export type ReasoningEffort=typeof REASONING_LEVELS[number]['id'];
export function parseReasoning(value:unknown):ReasoningEffort{
  if(typeof value!=='string'||!REASONING_LEVELS.some(level=>level.id===value))throw new Error('지원하지 않는 추론 수준입니다.');
  return value as ReasoningEffort;
}
export function reasoningLevels(model:{id:string;reasoningEfforts?:ReasoningEffort[]}):ReasoningEffort[]{
  return model.reasoningEfforts??(['gpt-6.1-sol','gpt-6-astra'].includes(model.id)?REASONING_LEVELS.map(l=>l.id):[]);
}
export const reasoningTimeout=(effort?:ReasoningEffort)=>effort==='ultra'?600000:['max','xhigh'].includes(effort||'')?300000:120000;
