import { useEffect, useRef, type ReactNode } from 'react';
export function AppDialog({label,onClose,children}:{label:string;onClose():void;children:ReactNode}){
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(()=>{dialog.current!.showModal();return()=>dialog.current?.close();},[]);
  return <dialog ref={dialog} className="app-dialog" aria-label={label} onCancel={e=>{e.preventDefault();onClose();}}><button className="app-dialog-close" aria-label="도구 닫기" onClick={onClose}>×</button>{children}</dialog>;
}
