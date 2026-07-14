export const sessionCookieName="hotel_ld_session";
export const refreshCookieName="hotel_ld_refresh";
export function readCookie(request:Request,name=sessionCookieName){const header=request.headers.get("cookie")??"";for(const item of header.split(";")){const[key,...rest]=item.trim().split("=");if(key===name)return decodeURIComponent(rest.join("="))}return null}
export function readRefreshCookie(request:Request){return readCookie(request,refreshCookieName)}
function cookie(name:string,token:string,maxAge:number,secure:boolean){return`${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure?"; Secure":""}`}
export function sessionCookie(token:string,secure:boolean){return cookie(sessionCookieName,token,3600,secure)}
export function refreshCookie(token:string,secure:boolean){return cookie(refreshCookieName,token,43200,secure)}
export function authCookies(accessToken:string,refreshToken:string|null,secure:boolean){return refreshToken?[sessionCookie(accessToken,secure),refreshCookie(refreshToken,secure)]:[sessionCookie(accessToken,secure)]}
export function expiredSessionCookie(secure:boolean){return`${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure?"; Secure":""}`}
export function expiredRefreshCookie(secure:boolean){return`${refreshCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure?"; Secure":""}`}
export function expiredAuthCookies(secure:boolean){return[expiredSessionCookie(secure),expiredRefreshCookie(secure)]}
