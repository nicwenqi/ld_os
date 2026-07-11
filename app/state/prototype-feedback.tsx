"use client";
import { createContext,useContext,useState } from "react";
const FeedbackContext=createContext<{showToast:(message:string)=>void}|null>(null);
export function PrototypeFeedbackProvider({children}:{children:React.ReactNode}){const[message,setMessage]=useState("");const showToast=(next:string)=>{setMessage(next);window.setTimeout(()=>setMessage(""),2800)};return <FeedbackContext.Provider value={{showToast}}>{children}{message&&<div className="toast" role="status"><span>✓</span>{message}</div>}</FeedbackContext.Provider>}
export function usePrototypeFeedback(){const value=useContext(FeedbackContext);if(!value)throw new Error("usePrototypeFeedback must be used within PrototypeFeedbackProvider");return value}
