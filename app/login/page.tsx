"use client";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AppProviders } from "../providers";
import { useAuthSession } from "../state/auth-session";
import { homeForRole } from "../services/auth-routing.ts";
import "./login.css";
import "./branding.css";

type PublicPropertyContext={configured:boolean;hostname?:string;nameZh?:string;nameEn?:string;shortName?:string;logoUrl?:string|null};
function LoginExperience(){const router=useRouter();const{login,status,session}=useAuthSession();const[property,setProperty]=useState<PublicPropertyContext|null>(null);const[loginId,setLoginId]=useState("");const[password,setPassword]=useState("");const[loading,setLoading]=useState(false);const[error,setError]=useState("");
  useEffect(()=>{void fetch("/api/property/context",{cache:"no-store"}).then(response=>response.json()).then(setProperty).catch(()=>setProperty({configured:false}))},[]);
  useEffect(()=>{if(status==="authenticated")router.replace(homeForRole(session.role))},[router,session.role,status]);
  async function submit(event:FormEvent){event.preventDefault();setError("");if(!loginId.trim()||password.length<8){setError("请输入用户 ID 和至少 8 位密码");return}setLoading(true);try{const next=await login({loginId,password,hostname:window.location.hostname});router.replace(homeForRole(next.role))}catch{setError("账号或密码错误")}finally{setLoading(false)}}
  return <main className="login-screen"><section className="login-identity"><div className={`login-brand-mark ${property?.logoUrl?"has-logo":""}`} aria-hidden="true">{property?.logoUrl?<img src={property.logoUrl} alt=""/>:"澜"}</div><div><span>酒店学习与发展运营系统</span><h1>{property?.nameZh??"酒店学习与发展"}</h1><p>{property?.nameEn??"Hotel Learning & Development OS"}</p></div><aside><strong>Hotel Learning &amp; Development OS</strong><p>以酒店域名确认运营环境，以个人账号确认角色与权限。</p></aside></section><section className="login-panel" aria-labelledby="login-title"><header><span>安全进入酒店工作台</span><h2 id="login-title">欢迎回来</h2><p>请输入酒店分配给您的用户 ID 与密码。</p></header><form onSubmit={submit}><label><span>用户 ID</span><input name="loginId" value={loginId} onChange={event=>setLoginId(event.target.value)} autoComplete="username" placeholder="请输入用户 ID" required autoFocus/></label><label><span>密码</span><input name="password" value={password} onChange={event=>setPassword(event.target.value)} type="password" minLength={8} autoComplete="current-password" placeholder="至少 8 位" required/></label>{error&&<div className="login-error" role="alert"><strong>{error}</strong><span>如账号已停用或无权访问当前酒店，请联系酒店管理员。</span></div>}<button type="submit" disabled={loading}>{loading?"正在验证账户…":"登录"}</button></form><footer><span>登录遇到问题？</span><p>请联系酒店学习与发展管理员。系统不会通过登录页显示账号是否存在。</p><small>账号已停用，请联系管理员 · 当前账号无权访问此酒店</small></footer></section></main>}
export default function LoginPage(){return<AppProviders><LoginExperience/></AppProviders>}
