import { useEffect,useState } from 'react';
import type { ChatModel } from '../../../../packages/shared-types/chat';
import { REASONING_LEVELS,reasoningLevels,type ReasoningEffort } from '../../../../packages/shared-types/reasoning';
import './reasoning.css';
export function useReasoning(owner:string,model?:ChatModel){
  const [values,setValues]=useState<Record<string,ReasoningEffort>>({}),[,refresh]=useState(0);
  const levels=model?reasoningLevels(model):[],key=`local-ai.reasoning.${owner}.${model?.id||''}`;
  let stored=values[key];try{stored=(localStorage.getItem(key)||stored) as ReasoningEffort;}catch{}
  const effort=levels.includes(stored)?stored:levels.includes('medium')?'medium':levels[0];
  useEffect(()=>{const change=()=>refresh(n=>n+1);window.addEventListener('reasoning-change',change);window.addEventListener('storage',change);return()=>{window.removeEventListener('reasoning-change',change);window.removeEventListener('storage',change);};},[]);
  function select(value:ReasoningEffort){if(!levels.includes(value))return;setValues(old=>({...old,[key]:value}));try{localStorage.setItem(key,value);}catch{}window.dispatchEvent(new Event('reasoning-change'));}
  return {effort,levels,select};
}
export function ReasoningPicker({value,levels,onChange,disabled=false}:{value?:ReasoningEffort;levels:ReasoningEffort[];onChange(value:ReasoningEffort):void;disabled?:boolean}){
  return <div className="reasoning-control"><label>추론 수준<select aria-label="추론 수준" value={value||''} disabled={disabled||!levels.length} onChange={e=>onChange(e.target.value as ReasoningEffort)}>{levels.length?REASONING_LEVELS.filter(l=>levels.includes(l.id)).map(l=><option key={l.id} value={l.id}>{l.label}</option>):<option value="">지원 설정 필요</option>}</select></label><small>{value==='ultra'?'Ultra: 병렬 검토 3개 후 종합 · 여러 번 요청하므로 시간과 사용량이 늘어납니다.':'다음 요청부터 적용 · 높은 수준은 시간과 사용량이 늘 수 있습니다.'}</small></div>;
}
