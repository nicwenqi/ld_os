"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AppShell } from "../components/shell/AppShell";
import { DataStateBadge } from "../components/operations/DataStateBadge";
import { ProtectedAppProviders } from "../providers";
import { useEscapeDismiss } from "../lib/use-escape-dismiss";
import { createRepositoryRegistry } from "../repositories/registry.ts";
import type { DepartmentAlias, DepartmentMovePreview, DepartmentNode, OfficialPosition, OperationalUnit, PositionFamily, PositionSourceLabel } from "../repositories/contracts/organization-models.ts";
import { usePrototypeFeedback } from "../state/prototype-feedback";
import { useAuthSession } from "../state/auth-session";

type AdministrationTab = "tree" | "mapping" | "positions" | "access";

function OrganizationWorkspace() {
  const registry = useMemo(() => createRepositoryRegistry(), []);
  const { showToast } = usePrototypeFeedback();
  const { session } = useAuthSession();
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const tab = administrationTab(searchParams.get("section"));
  const [tree, setTree] = useState<DepartmentNode[]>([]);
  const [aliases, setAliases] = useState<DepartmentAlias[]>([]);
  const [units, setUnits] = useState<OperationalUnit[]>([]);
  const [families, setFamilies] = useState<PositionFamily[]>([]);
  const [positions, setPositions] = useState<OfficialPosition[]>([]);
  const [positionSources, setPositionSources] = useState<PositionSourceLabel[]>([]);
  const [propertyId, setPropertyId] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [selectedAliasId, setSelectedAliasId] = useState("");
  const [selectedPositionSourceId, setSelectedPositionSourceId] = useState("");
  const [dialog, setDialog] = useState<"department" | "move" | "deactivate" | "family" | "position" | null>(null);
  const [departmentMode, setDepartmentMode] = useState<"top" | "child" | "rename">("top");
  const [departmentForm, setDepartmentForm] = useState({ nameZh: "", nameEn: "", code: "", nodeType: "department", sortOrder: 10 });
  const [moveTargetId, setMoveTargetId] = useState("");
  const [movePreview, setMovePreview] = useState<DepartmentMovePreview | null>(null);
  const [mappingTargetId, setMappingTargetId] = useState("");
  const [positionTargetId, setPositionTargetId] = useState("");
  const [familyTargetId, setFamilyTargetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const sourceState = registry.environment.dataMode === "mock" ? "demo" : "real";
  const sourceLabel = sourceState === "demo" ? "本地验证来源标签" : "当前酒店来源标签";
  useEscapeDismiss(Boolean(dialog), () => setDialog(null));

  const selectTab = (next: AdministrationTab) => {
    router.replace(`${pathname}?section=${next === "tree" ? "organization" : next}`, { scroll: false });
  };

  const loadOrganization = useCallback(async (candidatePropertyId: string) => {
    const [nextTree, nextAliases, nextUnits, nextFamilies, nextPositions, nextSources] = await Promise.all([
      registry.department.listTree(candidatePropertyId), registry.department.listAliases(candidatePropertyId),
      registry.department.listOperationalUnits(candidatePropertyId), registry.position.listPositionFamilies(candidatePropertyId),
      registry.position.listPositions(candidatePropertyId), registry.position.listSourceLabels(candidatePropertyId),
    ]);
    setTree(nextTree); setAliases(nextAliases); setUnits(nextUnits); setFamilies(nextFamilies); setPositions(nextPositions); setPositionSources(nextSources);
    setSelectedId(current => current && nextTree.some(item => item.id === current) ? current : nextTree[0]?.id ?? "");
    setSelectedAliasId(current => current && nextAliases.some(item => item.id === current) ? current : nextAliases[0]?.id ?? "");
    setSelectedPositionSourceId(current => current && nextSources.some(item => item.id === current) ? current : nextSources[0]?.id ?? "");
    setMappingTargetId(current => current || nextAliases[0]?.suggestedTargetId || "");
    setPositionTargetId(current => current || nextSources[0]?.suggestedPositionId || "");
    setFamilyTargetId(current => current || nextSources[0]?.suggestedFamilyId || "");
  }, [registry]);

  const refresh = async () => {
    if (propertyId) await loadOrganization(propertyId);
  };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const currentPropertyId = registry.environment.dataMode === "mock"
          ? (await registry.property.resolveContext("training-demo.example.test"))?.propertyId
          : session.propertyId;
        if (!currentPropertyId) throw new Error("当前账号尚未取得酒店组织上下文");
        if (!active) return; setPropertyId(currentPropertyId); await loadOrganization(currentPropertyId);
      } catch (reason) { if (active) setError(message(reason)); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [loadOrganization, registry, session.propertyId]);

  const selected = tree.find(item => item.id === selectedId) ?? null;
  const selectedAlias = aliases.find(item => item.id === selectedAliasId) ?? null;
  const selectedPositionSource = positionSources.find(item => item.id === selectedPositionSourceId) ?? null;
  const selectedChildren = selected ? tree.filter(item => item.parentId === selected.id) : [];
  const selectedUnits = selected ? units.filter(item => item.departmentId === selected.id) : [];
  const breadcrumb = selected ? selected.pathIds.map(id => tree.find(item => item.id === id)?.nameZh).filter(Boolean).join(" › ") : "";

  const openDepartmentDialog = (mode: "top" | "child" | "rename", seed?: string) => {
    setDepartmentMode(mode); setMovePreview(null); setError(null);
    setDepartmentForm(mode === "rename" && selected ? { nameZh: selected.nameZh, nameEn: selected.nameEn ?? "", code: selected.code ?? "", nodeType: selected.nodeType, sortOrder: selected.sortOrder } : { nameZh: seed ?? "", nameEn: seed ?? "", code: "", nodeType: mode === "child" ? "section" : "department", sortOrder: 10 });
    setDialog("department");
  };
  const saveDepartment = async () => {
    try {
      if (!departmentForm.nameZh.trim()) throw new Error("请输入正式中文名称");
      if (departmentMode === "rename" && selected) await registry.department.updateNode({ id: selected.id, expectedVersion: selected.version, nameZh: departmentForm.nameZh, nameEn: departmentForm.nameEn, sortOrder: departmentForm.sortOrder, isActive: selected.isActive });
      else {
        const parentId = departmentMode === "child" ? selected?.id ?? null : null;
        await registry.department.createNode({ tenantId: tree[0].tenantId, propertyId, parentId, nodeType: departmentForm.nodeType as DepartmentNode["nodeType"], code: departmentForm.code || slug(departmentForm.nameEn || departmentForm.nameZh), nameZh: departmentForm.nameZh, nameEn: departmentForm.nameEn, sortOrder: departmentForm.sortOrder });
      }
      await refresh(); setDialog(null); showToast(departmentMode === "rename" ? "部门名称已更新" : departmentMode === "top" ? "一级部门已创建" : "下级部门已创建");
    } catch (reason) { setError(message(reason)); }
  };
  const reorder = async (delta: number) => { if (!selected) return; try { await registry.department.updateNode({ id: selected.id, expectedVersion: selected.version, nameZh: selected.nameZh, nameEn: selected.nameEn ?? "", sortOrder: Math.max(0, selected.sortOrder + delta), isActive: selected.isActive }); await refresh(); showToast("部门显示顺序已调整"); } catch (reason) { setError(message(reason)); } };
  const generateMovePreview = async () => { if (!selected) return; try { setMovePreview(await registry.department.previewMove(selected.id, moveTargetId || null)); } catch (reason) { setError(`组织层级校验：${message(reason)}`); setMovePreview(null); } };
  const confirmMove = async () => { if (!selected || !movePreview) return; try { await registry.department.moveNode(selected.id, moveTargetId || null, selected.version); await refresh(); setDialog(null); setMovePreview(null); showToast("部门及全部下级部门已完成移动"); } catch (reason) { setError(`组织层级校验：${message(reason)}`); } };
  const confirmActive = async () => { if (!selected) return; try { await registry.department.setActive(selected.id, selected.version, !selected.isActive); await refresh(); setDialog(null); showToast(selected.isActive ? "部门已停用，历史路径仍被保留" : "部门已重新启用"); } catch (reason) { setError(message(reason)); } };

  const approveDepartment = async (action: "department" | "ignore" | "defer" | "merge") => { if (!selectedAlias) return; try { if (["department", "merge"].includes(action) && !mappingTargetId) throw new Error("请先选择正式目标部门"); await registry.department.approveMapping({ aliasId: selectedAlias.id, action, targetDepartmentId: mappingTargetId || undefined }); await refresh(); showToast(action === "ignore" ? "来源标签已标记为忽略" : action === "defer" ? "来源标签已保留为稍后处理" : "部门来源映射已批准并保存为别名"); } catch (reason) { setError(message(reason)); } };
  const classifyUnit = async () => { if (!selectedAlias || !mappingTargetId) return setError("请先选择运营单元所属的正式部门"); try { const target = tree.find(item => item.id === mappingTargetId)!; const unit = await registry.department.createOperationalUnit({ tenantId: target.tenantId, propertyId, departmentId: target.id, parentOperationalUnitId: null, unitType: "outlet", code: slug(selectedAlias.sourceValue), nameZh: selectedAlias.sourceValue, nameEn: selectedAlias.sourceValue, sortOrder: 20 }); await registry.department.approveMapping({ aliasId: selectedAlias.id, action: "operational_unit", operationalUnitId: unit.id }); await refresh(); showToast("来源标签已归类为运营单元，不会形成独立权限范围"); } catch (reason) { setError(message(reason)); } };
  const createFromAlias = (mode: "top" | "child") => { if (!selectedAlias) return; openDepartmentDialog(mode, selectedAlias.sourceValue); };

  const saveFamily = async () => { try { await registry.position.savePositionFamily({ tenantId: tree[0].tenantId, propertyId, code: `family-${families.length + 1}`, nameZh: "新职位族", nameEn: "New Position Family", description: "由管理员创建的酒店职位族", sortOrder: (families.length + 1) * 10, isActive: true }); await refresh(); setDialog(null); showToast("职位族已保存"); } catch (reason) { setError(message(reason)); } };
  const savePosition = async () => { try { await registry.position.savePosition({ tenantId: tree[0].tenantId, propertyId, positionFamilyId: families[0]?.id ?? null, code: `position-${positions.length + 1}`, nameZh: "新正式职位", nameEn: "New Official Position", gradeOrBand: "待配置", isActive: true }); await refresh(); setDialog(null); showToast("正式职位已保存"); } catch (reason) { setError(message(reason)); } };
  const mapPosition = async (action: "position" | "family" | "external" | "ignore" | "defer") => { if (!selectedPositionSource) return; try { if (action === "position" && !positionTargetId) throw new Error("请先选择正式职位"); if (action === "family" && !familyTargetId) throw new Error("请先选择职位族"); await registry.position.approvePositionMapping({ sourceLabelId: selectedPositionSource.id, action, targetPositionId: positionTargetId || undefined, targetPositionFamilyId: familyTargetId || undefined, externalRoleCode: action === "external" ? slug(selectedPositionSource.sourceValue) : undefined, externalRoleName: action === "external" ? selectedPositionSource.sourceValue : undefined }); await refresh(); showToast(action === "ignore" ? "职位来源标签已忽略" : action === "defer" ? "职位来源标签已保留为稍后处理" : "职位来源映射已批准并可供后续复用"); } catch (reason) { setError(message(reason)); } };

  if (loading) return <AppShell><div className="page-wrap org-loading">正在准备组织管理中心…</div></AppShell>;
  return <AppShell><div className="page-wrap organization-foundation-page">
    <header className="org-foundation-hero"><div><span>酒店管理基础 · HOTEL ADMINISTRATION</span><h1>组织、职位与访问管理</h1><p>维护当前酒店的正式组织树、来源归属、职位体系和后台访问边界。</p></div><aside><DataStateBadge state={sourceState}/><strong>{tree.filter(item => item.isActive).length}</strong><span>有效正式部门</span><small>任意层级 · 当前酒店</small></aside></header>
    {error && <div className="org-error" role="alert"><strong>需要处理</strong><span>{error}</span><button onClick={() => setError(null)}>关闭</button></div>}
    <section className="org-foundation-summary"><div><span>组织治理结论</span><h2>正式部门决定权限与汇总；运营单元只用于业务分析，不会获得独立权限。</h2><p>所有来源建议均需管理员明确确认，系统不会自动修改正式组织架构。</p></div><div className="org-summary-signals"><article><strong>{aliases.filter(item => item.resolutionType === "deferred").length}</strong><span>待认领标签</span></article><article><strong>{units.length}</strong><span>运营单元</span></article><article><strong>{positions.length}</strong><span>正式职位</span></article></div></section>

    <nav className="org-foundation-tabs" aria-label="组织管理模块">
      {[["tree","正式部门架构","Official hierarchy"],["mapping","部门归属维护","Department mapping"],["positions","职位与职位族","Positions"],["access","账号与角色","Access"]].map(([key, zh, en]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => selectTab(key as typeof tab)}><strong>{zh}</strong><small>{en}</small></button>)}
    </nav>

    {tab === "tree" && <div className="org-hierarchy-layout">
      <section className="official-tree-panel"><header><div><span>OFFICIAL DEPARTMENT TREE</span><h2>正式部门架构</h2><p>多级部门架构 · 不固定组织深度</p></div><button onClick={() => openDepartmentDialog("top")}>＋ 新增一级部门</button></header><div className="official-tree-list">{tree.map(item => <button key={item.id} className={`${selectedId === item.id ? "selected" : ""} ${item.isActive ? "" : "inactive"}`} style={{ paddingLeft: 18 + item.depth * 25 }} onClick={() => setSelectedId(item.id)}><i/><span><strong>{item.nameZh}</strong><small>{item.nameEn}</small></span><em>{nodeTypeLabel(item.nodeType)}</em><b>{item.syntheticEmployeeCount || "—"}</b></button>)}</div><footer><span>层级深度不设上限</span><small>内部识别码不会显示给使用者</small></footer></section>
      {selected && <section className="department-detail-panel"><header><div><span>当前路径</span><h2>{selected.nameZh} <small>{selected.nameEn}</small></h2><p>{breadcrumb}</p></div><em className={selected.isActive ? "healthy" : "inactive"}>{selected.isActive ? "使用中" : "已停用"}</em></header><div className="department-vitals"><article><strong>{selectedChildren.length}</strong><span>直属下级部门</span></article><article><strong>{selected.syntheticEmployeeCount || "—"}</strong><span>员工影响占位</span></article><article><strong>{selectedUnits.length}</strong><span>运营单元</span></article><article><strong>v{selected.version}</strong><span>并发版本</span></article></div><div className="department-actions"><button onClick={() => openDepartmentDialog("child")}>＋ 新增下级部门</button><button onClick={() => openDepartmentDialog("rename")}>重命名</button><button onClick={() => void reorder(-10)}>↑ 调整顺序</button><button onClick={() => { setMoveTargetId(selected.parentId ?? ""); setMovePreview(null); setDialog("move"); }}>移动部门</button><button className="danger-soft" onClick={() => setDialog("deactivate")}>{selected.isActive ? "停用部门" : "重新启用"}</button></div><section className="operational-unit-card"><div><span>OPERATIONAL UNITS</span><h3>运营单元</h3><p>归属正式部门，但不授予独立权限范围。</p></div>{selectedUnits.length ? selectedUnits.map(unit => <article key={unit.id}><i/><span><strong>{unit.nameZh}</strong><small>{unit.nameEn} · {unit.unitType}</small></span><em>{unit.isActive ? "使用中" : "停用"}</em></article>) : <div className="compact-empty">当前部门暂无运营单元</div>}</section></section>}
    </div>}

    {tab === "mapping" && <div className="mapping-center-layout"><section className="source-claim-list"><header><div><span>SOURCE SIDE</span><h2>部门认领与映射</h2><p>{sourceLabel} · 仅呈现当前仓储返回的记录</p></div><em>{aliases.length} 个标签</em></header>{aliases.map(aliasItem => <button key={aliasItem.id} className={selectedAliasId === aliasItem.id ? "selected" : ""} onClick={() => { setSelectedAliasId(aliasItem.id); setMappingTargetId(aliasItem.suggestedTargetId ?? ""); }}><div><strong>{aliasItem.sourceValue}</strong><small>{aliasItem.normalizedSourceValue}</small></div><span>{aliasItem.syntheticEmployeeCount} 人 · {aliasItem.sourceRowCount} 行</span><em className={aliasItem.resolutionType}>{resolutionLabel(aliasItem.resolutionType)}</em></button>)}</section>{selectedAlias && <section className="mapping-decision-panel"><header><div><span>来源标签 · {selectedAlias.sourceSystem}</span><h2>{selectedAlias.sourceValue}</h2><p>{selectedAlias.sourceSheet} · {sourceState === "demo" ? "验证影响" : "记录影响"} {selectedAlias.syntheticEmployeeCount} 人</p></div><strong>{selectedAlias.confidence}%<small>置信度</small></strong></header><div className="mapping-suggestion"><span>匹配建议</span><h3>{selectedAlias.suggestionLabel}</h3><p><strong>建议原因：</strong>{selectedAlias.suggestionReason}</p><div><i style={{ width: `${selectedAlias.confidence}%` }}/></div></div><label className="mapping-target"><span>正式目标路径</span><select value={mappingTargetId} onChange={event => setMappingTargetId(event.target.value)}><option value="">请选择正式部门</option>{tree.map(item => <option key={item.id} value={item.id}>{item.pathIds.map(id => tree.find(node => node.id === id)?.nameZh).join(" / ")}</option>)}</select></label><div className="mapping-impact"><article><strong>{selectedAlias.sourceRowCount}</strong><span>来源行数</span></article><article><strong>{selectedAlias.syntheticEmployeeCount}</strong><span>{sourceState === "demo" ? "验证影响" : "记录影响"}</span></article><article><strong>{selectedAlias.confidence}%</strong><span>自动建议置信度</span></article></div><div className="mapping-actions"><button onClick={() => void approveDepartment("department")}>映射到现有部门</button><button onClick={() => createFromAlias("top")}>新建一级部门</button><button onClick={() => createFromAlias("child")}>新建下级部门</button><button onClick={() => void classifyUnit()}>归类为运营单元</button><button onClick={() => void approveDepartment("department")}>保存为别名</button><button onClick={() => void approveDepartment("merge")}>合并来源标签</button><button className="quiet" onClick={() => void approveDepartment("ignore")}>忽略</button><button className="quiet" onClick={() => void approveDepartment("defer")}>稍后处理</button></div><p className="structure-warning">所有结构变更均需明确确认；匹配建议不会自动修改正式组织架构。</p></section>}</div>}

    {tab === "positions" && <div className="position-foundation-grid"><section className="position-catalog"><header><div><span>POSITION CATALOG</span><h2>职位族与正式职位</h2></div><div><button onClick={() => setDialog("family")}>＋ 新增职位族</button><button onClick={() => setDialog("position")}>＋ 新增正式职位</button></div></header><div className="family-strip">{families.map(family => <article key={family.id}><i/><strong>{family.nameZh}</strong><small>{family.nameEn}</small><span>{positions.filter(position => position.positionFamilyId === family.id).length} 个职位</span><button disabled title="职位族编辑将在 Recovery B 完成">编辑职位族</button></article>)}</div><h3>正式职位</h3><div className="official-position-list">{positions.map(position => <article key={position.id}><div><strong>{position.nameZh}</strong><small>{position.nameEn} · {position.gradeOrBand}</small></div><span>{families.find(family => family.id === position.positionFamilyId)?.nameZh ?? "未分类"}</span><em>{position.departmentIds.length} 个适用部门</em><button onClick={async () => { if (!selected) return setError("请先在正式部门架构中选择部门"); await registry.position.assignPositionToDepartments(position.id, [selected.id]); await refresh(); showToast(`${position.nameZh}的适用部门已更新`); }}>管理适用部门</button></article>)}</div></section><section className="position-mapping-panel"><header><span>POSITION SOURCE MAPPING</span><h2>职位来源映射</h2><p>保留原始来源值，批准后供后续员工资料更新复用。</p></header><div className="position-source-chips">{positionSources.map(source => <button className={selectedPositionSourceId === source.id ? "active" : ""} key={source.id} onClick={() => { setSelectedPositionSourceId(source.id); setPositionTargetId(source.suggestedPositionId ?? ""); setFamilyTargetId(source.suggestedFamilyId ?? ""); }}>{source.sourceValue}<small>{source.syntheticEmployeeCount} 人</small></button>)}</div>{selectedPositionSource && <div className="position-source-detail"><h3>{selectedPositionSource.sourceValue}</h3><p>{selectedPositionSource.suggestionReason}</p><div className="position-impact"><span><strong>{selectedPositionSource.syntheticEmployeeCount}</strong> 受影响员工</span><span><strong>{selectedPositionSource.departmentNames.length}</strong> 适用部门</span><span><strong>{selectedPositionSource.confidence}%</strong> 建议置信度</span></div><label>现有正式职位<select value={positionTargetId} onChange={event => setPositionTargetId(event.target.value)}><option value="">请选择</option>{positions.map(position => <option key={position.id} value={position.id}>{position.nameZh} · {position.nameEn}</option>)}</select></label><label>职位族<select value={familyTargetId} onChange={event => setFamilyTargetId(event.target.value)}><option value="">请选择</option>{families.map(family => <option key={family.id} value={family.id}>{family.nameZh} · {family.nameEn}</option>)}</select></label><div className="position-map-actions"><button onClick={() => void mapPosition("position")}>映射到现有职位</button><button onClick={() => setDialog("position")}>创建正式职位</button><button onClick={() => void mapPosition("family")}>仅映射职位族</button><button onClick={() => void mapPosition("external")}>仅作为外部 LMS 角色</button><button className="quiet" onClick={() => void mapPosition("ignore")}>忽略</button><button className="quiet" onClick={() => void mapPosition("defer")}>稍后处理</button></div></div>}</section></div>}

    {tab === "access" && <section className="access-continuity"><header><div><span>ACCESS CONTINUITY</span><h2>账号与角色</h2><p>当前只承认酒店学习与发展经理、部门培训负责人两类后台角色。</p></div><button disabled title="账号管理将在 Recovery B 接入真实保存">＋ 添加后台账号</button></header><div className="truthful-empty"><h3>账号与部门授权管理尚未在此页面接入</h3><p>现有登录、成员资格、角色分配与部门范围继续由已验证的权限基础执行。本阶段不展示合成账号、不提供角色切换，也不产生看似成功的邀请操作。</p></div><div className="role-boundary-card"><article><h3>酒店学习与发展经理</h3><p>管理当前酒店的正式组织、员工主数据和酒店级运营基础。</p></article><article><h3>部门培训负责人</h3><p>只访问已授权的正式部门分支；不能修改酒店级设置、组织或账号权限。</p></article><article><h3>普通员工</h3><p>仅作为员工主数据记录存在，不是后台应用账号。</p></article></div></section>}

    {dialog === "department" && <Modal title={departmentMode === "top" ? "新增一级部门" : departmentMode === "child" ? "新增下级部门" : "重命名部门"} onClose={() => setDialog(null)}><p>正式部门将驱动权限、筛选与后续报表范围。</p><label>正式中文名称<input value={departmentForm.nameZh} onChange={event => setDepartmentForm({ ...departmentForm, nameZh: event.target.value })}/></label><label>英文名称<input value={departmentForm.nameEn} onChange={event => setDepartmentForm({ ...departmentForm, nameEn: event.target.value })}/></label><label>部门代码<input disabled={departmentMode === "rename"} value={departmentForm.code} onChange={event => setDepartmentForm({ ...departmentForm, code: event.target.value })}/></label><label>节点类型<select value={departmentForm.nodeType} disabled={departmentMode === "rename"} onChange={event => setDepartmentForm({ ...departmentForm, nodeType: event.target.value })}><option value="division">业务板块 Division</option><option value="department">部门 Department</option><option value="section">分部 Section</option><option value="team">小组 Team</option><option value="other">其他 Other</option></select></label><footer><button onClick={() => setDialog(null)}>取消</button><button onClick={() => void saveDepartment()}>确认保存</button></footer></Modal>}
    {dialog === "move" && selected && <Modal title="移动影响预览" onClose={() => setDialog(null)}><p>移动操作将以事务方式重建受影响子树的路径和闭包关系。</p><label>目标路径<select value={moveTargetId} onChange={event => { setMoveTargetId(event.target.value); setMovePreview(null); }}><option value="">设为一级部门</option>{tree.filter(item => item.id !== selected.id).map(item => <option key={item.id} value={item.id}>{item.pathIds.map(id => tree.find(node => node.id === id)?.nameZh).join(" / ")}</option>)}</select></label><button className="preview-button" onClick={() => void generateMovePreview()}>生成移动影响预览</button>{movePreview && <div className="move-preview"><dl><div><dt>当前路径</dt><dd>{movePreview.currentPath}</dd></div><div><dt>目标路径</dt><dd>{movePreview.proposedPath}</dd></div></dl><section><article><strong>{movePreview.childDepartmentsAffected}</strong><span>下级部门</span></article><article><strong>{movePreview.syntheticEmployeeImpact}</strong><span>员工影响</span></article><article><strong>{movePreview.aliasesAffected}</strong><span>别名</span></article><article><strong>{movePreview.operationalUnitsAffected}</strong><span>运营单元</span></article></section><p>注意：所有下级部门将一并移动，正式路径与报表汇总范围会同时更新。</p></div>}<footer><button onClick={() => setDialog(null)}>取消</button><button disabled={!movePreview} onClick={() => void confirmMove()}>确认移动</button></footer></Modal>}
    {dialog === "deactivate" && selected && <Modal title={selected.isActive ? "停用部门" : "重新启用部门"} onClose={() => setDialog(null)}><p>{selected.isActive ? "停用不会删除部门或历史路径；下级部门与映射仍会保留。" : "重新启用后，该部门将恢复为可选的正式组织节点。"}</p><div className="confirm-path">{breadcrumb}</div><footer><button onClick={() => setDialog(null)}>取消</button><button onClick={() => void confirmActive()}>确认{selected.isActive ? "停用" : "启用"}</button></footer></Modal>}
    {dialog === "family" && <Modal title="编辑职位族" onClose={() => setDialog(null)}><p>职位族用于归一化岗位分析，不等同于系统权限角色。</p><div className="confirm-path">管理人员 / 主管人员 / 一线员工 / 厨房岗位 / 工程岗位</div><footer><button onClick={() => setDialog(null)}>取消</button><button onClick={() => void saveFamily()}>保存职位族</button></footer></Modal>}
    {dialog === "position" && <Modal title="创建正式职位" onClose={() => setDialog(null)}><p>正式职位可分配到多个部门，并保留来源职位别名。</p><div className="confirm-path">新正式职位 · New Official Position · 职级待配置</div><footer><button onClick={() => setDialog(null)}>取消</button><button onClick={() => void savePosition()}>保存正式职位</button></footer></Modal>}
  </div></AppShell>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) { return <div className="dialog-backdrop" onMouseDown={onClose}><div className="dialog org-foundation-dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={event => event.stopPropagation()}><header><div><span>ORGANIZATION ACTION</span><h2>{title}</h2></div><button onClick={onClose} aria-label={`关闭${title}`}>×</button></header>{children}</div></div>; }
function nodeTypeLabel(type: DepartmentNode["nodeType"]) { return ({ division: "板块", department: "部门", section: "分部", team: "小组", other: "其他" })[type]; }
function resolutionLabel(type: DepartmentAlias["resolutionType"]) { return ({ mapped: "已映射", created_top_level: "已新建", created_child: "已新建", merged: "已合并", ignored: "已忽略", deferred: "待处理" })[type]; }
function administrationTab(section: string | null): AdministrationTab {
  if (section === "positions" || section === "access" || section === "mapping") return section;
  return "tree";
}
function slug(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `node-${Date.now()}`; }
function message(reason: unknown) { return reason instanceof Error ? reason.message : "操作未完成，请重试"; }

export default function Permissions() { return <ProtectedAppProviders><OrganizationWorkspace/></ProtectedAppProviders>; }
