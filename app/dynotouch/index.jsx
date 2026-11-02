import React from 'react';
import {createRoot} from 'react-dom/client';
import EventClient from './event-client.tsx';
import './dynotouch.css';
let mounted=null,container=null;
export function cleanupDynoTouch(){if(mounted){mounted.unmount();mounted=null;container=null;}}
export function renderDynoTouch(root,user){
  if(container!==root){cleanupDynoTouch();container=root;const shell=document.createElement('div');shell.className='dt-shell';root.replaceChildren(shell);mounted=createRoot(shell);}
  const parts=location.hash.replace(/^#\//,'').split('/');
  let kind='home',id=parts[2]||'';
  if(parts[1]==='admin')kind='admin';
  else if(parts[1]==='c')kind='claim';
  else if(parts[1]==='e')kind=parts[3]==='manage'?'manage':'event';
  mounted.render(<EventClient key={kind+'/'+id+'/'+(user?.uid||'anonymous')} kind={kind} id={id} signedIn={!!user}/>);
}
