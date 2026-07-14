export const sessionCookieName="hotel_ld_session";
export function readCookie(request:Request,name=sessionCookieName){const header=request.headers.get("cookie")??"";for(const item of header.split(";")){const[key,...rest]=item.trim().split("=");if(key===name)return decodeURIComponent(rest.join("="))}return null}
export function sessionCookie(token:string,secure:boolean){return`${sessionCookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure?"; Secure":""}`}
export function expiredSessionCookie(secure:boolean){return`${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure?"; Secure":""}`}
