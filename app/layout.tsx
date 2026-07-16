import type { Metadata } from "next";
import "./globals.css";
export const metadata:Metadata={title:"酒店学习与发展运营系统 | Hotel L&D OS",description:"面向酒店学习与发展经理及部门培训负责人的培训运营管理系统。",icons:{icon:"/favicon.svg"}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
