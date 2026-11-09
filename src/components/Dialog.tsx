import {useEffect,useRef,type ReactNode} from 'react';
import {Icon} from './Icon';
export function Dialog({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close();},[]);
 return <dialog ref={ref} className={`modal ${wide?'wide':''}`} onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===e.currentTarget)onClose();}} aria-label={title}><div className="modal-inner"><div className="modal-heading"><h2>{title}</h2><button aria-label="Tutup dialog" onClick={onClose}><Icon name="close" size={20}/></button></div>{children}</div></dialog>;
}
