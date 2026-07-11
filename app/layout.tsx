import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"酒店学习与发展运营系统 | Hotel L&D OS",description:"面向中国酒店的学习与发展运营系统高保真原型。",icons:{icon:"/favicon.svg"}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
