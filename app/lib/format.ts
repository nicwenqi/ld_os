export const formatDepartment=(item:{nameZh:string;nameEn:string})=>`${item.nameZh} ${item.nameEn}`;
export const formatPercent=(value:number)=>`${value.toFixed(1)}%`;
export const formatEmployee=(item:{nameZh:string;nameEn:string})=>`${item.nameZh} · ${item.nameEn}`;
