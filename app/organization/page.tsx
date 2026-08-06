"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  AdministrationSaveState,
  savedTime,
  type AdministrationSavePhase,
  useUnsavedChangesWarning,
} from "../components/administration/AdministrationSaveState";
import { DataStateBadge } from "../components/operations/DataStateBadge";
import { AppShell } from "../components/shell/AppShell";
import { ProtectedAppProviders } from "../providers";
import type {
  DepartmentMovePreview,
  DepartmentNode,
  DepartmentNodeType,
  OperationalUnit,
  OperationalUnitType,
} from "../repositories/contracts/organization-models.ts";
import {
  loadRuntimeDomainRegistry,
  usesFallbackDomainRegistry,
} from "../repositories/runtime/load-domain-registry.ts";
import type { RuntimeDomainRegistry } from "../repositories/runtime/neon-domain-registry.ts";
import { useAuthSession } from "../state/auth-session";

type DepartmentDraft = {
  id: string | null;
  expectedVersion: number | null;
  parentId: string | null;
  nodeType: DepartmentNodeType;
  code: string;
  nameZh: string;
  nameEn: string;
  sortOrder: number;
  isActive: boolean;
};

type UnitDraft = {
  id: string | null;
  expectedVersion: number | null;
  departmentId: string;
  parentOperationalUnitId: string | null;
  unitType: OperationalUnitType;
  code: string;
  nameZh: string;
  nameEn: string;
  sortOrder: number;
  isActive: boolean;
};

function OrganizationAdministration() {
  const { session } = useAuthSession();
  const [registry, setRegistry] = useState<RuntimeDomainRegistry | null>(null);
  const [propertyId, setPropertyId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [tree, setTree] = useState<DepartmentNode[]>([]);
  const [units, setUnits] = useState<OperationalUnit[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [departmentDraft, setDepartmentDraft] = useState<DepartmentDraft | null>(null);
  const [unitDraft, setUnitDraft] = useState<UnitDraft | null>(null);
  const [moveTargetId, setMoveTargetId] = useState("");
  const [movePreview, setMovePreview] = useState<DepartmentMovePreview | null>(null);
  const [phase, setPhase] = useState<AdministrationSavePhase>("pristine");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const dirty = hasUnsavedChanges;
  useUnsavedChangesWarning(dirty, "组织资料有未保存更改");

  const sourceState = registry?.environment.dataMode === "mock" ? "demo" : "real";

  useEffect(() => {
    let active = true;
    void loadRuntimeDomainRegistry()
      .then(next => { if (active) setRegistry(next); })
      .catch(error => {
        if (!active) return;
        setPhase("failed");
        setStatusMessage(message(error));
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const reload = useCallback(async (preferred?: { departmentId?: string; unitId?: string }) => {
    if (!registry) throw new Error("运行时组织来源尚未连接");
    const nextPropertyId = session.propertyId;
    if (!nextPropertyId) throw new Error("当前账号尚未取得酒店组织上下文");
    const [property, nextTree, nextUnits] = await Promise.all([
      usesFallbackDomainRegistry(registry) && registry.property
        ? registry.property.getProperty(nextPropertyId)
        : Promise.resolve(null),
      registry.department.listTree(nextPropertyId),
      registry.department.listOperationalUnits(nextPropertyId),
    ]);
    setPropertyId(nextPropertyId);
    setTenantId(
      property?.identity.tenantId ?? nextTree[0]?.tenantId ?? nextUnits[0]?.tenantId ?? "",
    );
    setTree(nextTree);
    setUnits(nextUnits);
    setSelectedDepartmentId(current => {
      const candidate = preferred?.departmentId ?? current;
      return nextTree.some(item => item.id === candidate) ? candidate : nextTree[0]?.id ?? "";
    });
    setSelectedUnitId(current => {
      const candidate = preferred?.unitId ?? current;
      return nextUnits.some(item => item.id === candidate) ? candidate : "";
    });
  }, [registry, session.propertyId]);

  useEffect(() => {
    if (!registry) return;
    let active = true;
    queueMicrotask(() => {
      void reload()
        .catch(error => {
          if (active) {
            setPhase("failed");
            setStatusMessage(message(error));
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    });
    return () => {
      active = false;
    };
  }, [registry, reload]);

  const selectedDepartment =
    tree.find(item => item.id === selectedDepartmentId) ?? null;
  const selectedUnit = units.find(item => item.id === selectedUnitId) ?? null;
  const departmentUnits = units.filter(
    item => item.departmentId === selectedDepartmentId,
  );

  useEffect(() => {
    if (dirty || departmentDraft?.id === selectedDepartmentId) return;
    queueMicrotask(() => setDepartmentDraft(
      selectedDepartment ? departmentDraftFrom(selectedDepartment) : null,
    ));
  }, [departmentDraft?.id, dirty, selectedDepartment, selectedDepartmentId]);

  useEffect(() => {
    if (dirty || unitDraft?.id === selectedUnitId) return;
    queueMicrotask(() => setUnitDraft(selectedUnit ? unitDraftFrom(selectedUnit) : null));
  }, [dirty, selectedUnit, selectedUnitId, unitDraft?.id]);

  const chooseDepartment = (id: string) => {
    if (!canLeaveDirty(dirty)) return;
    setSelectedDepartmentId(id);
    setSelectedUnitId("");
    setDepartmentDraft(departmentDraftFrom(tree.find(item => item.id === id)!));
    setUnitDraft(null);
    resetSaveState();
  };

  const chooseUnit = (unit: OperationalUnit) => {
    if (!canLeaveDirty(dirty)) return;
    setSelectedUnitId(unit.id);
    setUnitDraft(unitDraftFrom(unit));
    setDepartmentDraft(null);
    resetSaveState();
  };

  const newDepartment = (parentId: string | null) => {
    if (!canLeaveDirty(dirty)) return;
    setSelectedUnitId("");
    setDepartmentDraft({
      id: null,
      expectedVersion: null,
      parentId,
      nodeType: parentId ? "section" : "department",
      code: "",
      nameZh: "",
      nameEn: "",
      sortOrder: nextSortOrder(tree, parentId),
      isActive: true,
    });
    setUnitDraft(null);
    setPhase("dirty");
    setHasUnsavedChanges(true);
    setStatusMessage(parentId ? "正在新增下级正式部门" : "正在新增一级正式部门");
  };

  const newOperationalUnit = () => {
    if (!selectedDepartment || !canLeaveDirty(dirty)) return;
    setSelectedUnitId("");
    setDepartmentDraft(null);
    setUnitDraft({
      id: null,
      expectedVersion: null,
      departmentId: selectedDepartment.id,
      parentOperationalUnitId: null,
      unitType: "outlet",
      code: "",
      nameZh: "",
      nameEn: "",
      sortOrder: departmentUnits.length * 10 + 10,
      isActive: true,
    });
    setPhase("dirty");
    setHasUnsavedChanges(true);
    setStatusMessage("正在新增运营单元");
  };

  const saveDepartment = async () => {
    if (!departmentDraft || !registry) return;
    try {
      validateDepartment(departmentDraft);
      setPhase("saving");
      setStatusMessage("正在写入正式组织并重新读取服务器状态");
      const saved = departmentDraft.id
        ? await registry.department.updateNode({
            id: departmentDraft.id,
            expectedVersion: departmentDraft.expectedVersion!,
            nameZh: departmentDraft.nameZh,
            nameEn: departmentDraft.nameEn,
            sortOrder: departmentDraft.sortOrder,
            isActive: departmentDraft.isActive,
          })
        : await registry.department.createNode({
            tenantId,
            propertyId,
            parentId: departmentDraft.parentId,
            nodeType: departmentDraft.nodeType,
            code: departmentDraft.code,
            nameZh: departmentDraft.nameZh,
            nameEn: departmentDraft.nameEn,
            sortOrder: departmentDraft.sortOrder,
          });
      await reload({ departmentId: saved.id });
      const authoritative = await registry.department.getNode(saved.id);
      setSelectedDepartmentId(authoritative.id);
      setDepartmentDraft(departmentDraftFrom(authoritative));
      markSaved("正式部门已保存并重新读取");
    } catch (error) {
      markFailure(error);
    }
  };

  const saveUnit = async () => {
    if (!unitDraft || !registry) return;
    try {
      validateUnit(unitDraft);
      setPhase("saving");
      setStatusMessage("正在写入运营单元并重新读取服务器状态");
      const saved = await registry.department.saveOperationalUnit({
        id: unitDraft.id ?? undefined,
        expectedVersion: unitDraft.expectedVersion ?? undefined,
        tenantId,
        propertyId,
        departmentId: unitDraft.departmentId,
        parentOperationalUnitId: unitDraft.parentOperationalUnitId,
        unitType: unitDraft.unitType,
        code: unitDraft.code,
        nameZh: unitDraft.nameZh,
        nameEn: unitDraft.nameEn,
        sortOrder: unitDraft.sortOrder,
        isActive: unitDraft.isActive,
      });
      await reload({ departmentId: saved.departmentId, unitId: saved.id });
      const authoritative = (
        await registry.department.listOperationalUnits(propertyId)
      ).find(item => item.id === saved.id);
      setSelectedDepartmentId(saved.departmentId);
      setSelectedUnitId(saved.id);
      setUnitDraft(unitDraftFrom(authoritative ?? saved));
      markSaved("运营单元已保存并重新读取");
    } catch (error) {
      markFailure(error);
    }
  };

  const previewMove = async () => {
    if (!selectedDepartment || !registry) return;
    try {
      setMovePreview(
        await registry.department.previewMove(
          selectedDepartment.id,
          moveTargetId || null,
        ),
      );
    } catch (error) {
      setStatusMessage(message(error));
      setPhase("failed");
    }
  };

  const confirmMove = async () => {
    if (!selectedDepartment || !movePreview || !registry) return;
    try {
      setPhase("saving");
      const saved = await registry.department.moveNode(
        selectedDepartment.id,
        moveTargetId || null,
        selectedDepartment.version,
      );
      await reload({ departmentId: saved.id });
      setDepartmentDraft(departmentDraftFrom(saved));
      setMovePreview(null);
      markSaved("部门及下级路径已更新");
    } catch (error) {
      markFailure(error);
    }
  };

  const reloadLatest = async () => {
    if (!registry) return;
    try {
      await reload({
        departmentId: selectedDepartmentId,
        unitId: selectedUnitId,
      });
      setDepartmentDraft(
        selectedDepartmentId
          ? departmentDraftFrom(await registry.department.getNode(selectedDepartmentId))
          : null,
      );
      const nextPropertyId = propertyId || session.propertyId;
      const nextUnits = nextPropertyId
        ? await registry.department.listOperationalUnits(nextPropertyId)
        : [];
      const latestUnit = nextUnits.find(item => item.id === selectedUnitId);
      setUnitDraft(
        selectedUnitId && latestUnit ? unitDraftFrom(latestUnit) : null,
      );
      resetSaveState();
    } catch (error) {
      setPhase("failed");
      setStatusMessage(message(error));
    }
  };

  const markSaved = (detail: string) => {
    setPhase("saved");
    setHasUnsavedChanges(false);
    setSavedAt(savedTime());
    setStatusMessage(detail);
  };
  const markFailure = (error: unknown) => {
    setPhase(isConflict(error) ? "conflict" : "failed");
    setStatusMessage(message(error));
  };
  const resetSaveState = () => {
    setPhase("pristine");
    setHasUnsavedChanges(false);
    setSavedAt(null);
    setStatusMessage(null);
    setMovePreview(null);
  };
  const retryInitialLoad = async () => {
    setLoading(true);
    setPhase("pristine");
    setStatusMessage(null);
    try {
      await reload();
      resetSaveState();
    } catch (error) {
      setPhase("failed");
      setStatusMessage(message(error));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <AppShell><div className="page-wrap administration-loading">正在读取正式组织…</div></AppShell>;
  }
  if (!propertyId) {
    return (
      <AppShell>
        <div className="page-wrap administration-page">
          <section className="source-load-failure" role="alert">
            <DataStateBadge state="failed" />
            <h1>正式组织暂时无法读取</h1>
            <p>{statusMessage ?? "系统不会把读取失败解释为零个部门或已完成组织设置。"}</p>
            <button type="button" onClick={() => void retryInitialLoad()}>重新读取</button>
            <Link href="/">返回运营工作台</Link>
          </section>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page-wrap administration-page organization-administration-page">
        <header className="administration-hero">
          <div>
            <nav className="administration-breadcrumb" aria-label="页面路径">
              <Link href="/">运营工作台</Link><span>›</span><strong>组织架构</strong>
            </nav>
            <span>HOTEL ORGANIZATION FOUNDATION</span>
            <h1>组织架构</h1>
            <p>维护当前酒店的正式部门层级与运营单元。正式部门决定汇总和授权边界；运营单元只用于业务归属。</p>
          </div>
          <aside>
            <DataStateBadge state={sourceState} />
            <strong>{tree.filter(item => item.isActive).length}</strong>
            <span>有效正式部门</span>
            <small>支持任意层级</small>
          </aside>
        </header>

        <section className="administration-command-bar">
          <AdministrationSaveState
            phase={phase}
            savedAt={savedAt}
            message={statusMessage}
            onRetry={() => void (dirty ? (unitDraft ? saveUnit() : saveDepartment()) : reloadLatest())}
            onReload={() => void reloadLatest()}
          />
          <div>
            <button type="button" onClick={() => newDepartment(null)}>新增一级部门</button>
            <button type="button" disabled={!selectedDepartment} onClick={() => newDepartment(selectedDepartment?.id ?? null)}>新增下级部门</button>
            <button type="button" disabled={!selectedDepartment} onClick={newOperationalUnit}>新增运营单元</button>
          </div>
        </section>

        <div className="organization-admin-layout">
          <section className="administration-index-panel">
            <header>
              <span>OFFICIAL HIERARCHY</span>
              <h2>正式部门架构</h2>
              <p>选择一个部门查看和维护资料。</p>
            </header>
            {tree.length ? (
              <div className="administration-tree-list">
                {tree.map(item => (
                  <button
                    type="button"
                    className={`${selectedDepartmentId === item.id ? "selected" : ""} ${item.isActive ? "" : "inactive"}`}
                    style={{ paddingLeft: 16 + item.depth * 22 }}
                    key={item.id}
                    onClick={() => chooseDepartment(item.id)}
                  >
                    <i aria-hidden="true" />
                    <span><strong>{item.nameZh}</strong><small>{item.nameEn || "未填写英文名"}</small></span>
                    <em>{nodeTypeLabel(item.nodeType)}</em>
                  </button>
                ))}
              </div>
            ) : (
              <div className="administration-empty">
                <strong>尚未建立正式部门</strong>
                <p>新增第一个一级部门后，即可建立酒店组织路径和部门授权基础。</p>
                <button type="button" onClick={() => newDepartment(null)}>新增一级部门</button>
              </div>
            )}
          </section>

          <section className="administration-editor-panel">
            {departmentDraft && (
              <>
                <EditorHeading
                  eyebrow={departmentDraft.id ? "DEPARTMENT DETAILS" : "NEW OFFICIAL DEPARTMENT"}
                  title={departmentDraft.id ? departmentDraft.nameZh : "新增正式部门"}
                  detail={departmentDraft.id ? departmentPath(tree, departmentDraft.id) : "保存后成为当前酒店的正式组织节点"}
                />
                <div className="administration-form-grid">
                  <Field label="中文名称" required>
                    <input value={departmentDraft.nameZh} onChange={event => updateDepartment("nameZh", event.target.value)} />
                  </Field>
                  <Field label="英文名称">
                    <input value={departmentDraft.nameEn} onChange={event => updateDepartment("nameEn", event.target.value)} />
                  </Field>
                  {!departmentDraft.id && (
                    <>
                      <Field label="部门识别码" required>
                        <input value={departmentDraft.code} onChange={event => updateDepartment("code", event.target.value)} placeholder="例如 front-office" />
                      </Field>
                      <Field label="组织类型">
                        <select value={departmentDraft.nodeType} onChange={event => updateDepartment("nodeType", event.target.value as DepartmentNodeType)}>
                          <option value="division">事业部 / 大部门</option>
                          <option value="department">部门</option>
                          <option value="section">分部</option>
                          <option value="team">班组</option>
                          <option value="other">其他</option>
                        </select>
                      </Field>
                    </>
                  )}
                  <Field label="显示顺序">
                    <input type="number" value={departmentDraft.sortOrder} onChange={event => updateDepartment("sortOrder", Number(event.target.value))} />
                  </Field>
                  {departmentDraft.id && (
                    <label className="administration-toggle">
                      <span><strong>部门使用状态</strong><small>停用后保留历史路径，但不能用于新的授权范围。</small></span>
                      <input type="checkbox" checked={departmentDraft.isActive} onChange={event => updateDepartment("isActive", event.target.checked)} />
                      <i aria-hidden="true" />
                    </label>
                  )}
                </div>
                <footer className="administration-editor-actions">
                  <button type="button" className="primary" disabled={phase === "saving" || phase === "conflict" || !dirty} onClick={() => void saveDepartment()}>
                    {phase === "saving" ? "保存中…" : "保存正式部门"}
                  </button>
                </footer>
                {departmentDraft.id && (
                  <section className="organization-move-panel">
                    <div>
                      <strong>调整组织路径</strong>
                      <p>先预览下级部门、别名与运营单元影响，再确认移动。</p>
                    </div>
                    <select disabled={dirty} title={dirty ? "请先保存当前部门资料" : "选择新的上级部门"} value={moveTargetId} onChange={event => { setMoveTargetId(event.target.value); setMovePreview(null); }}>
                      <option value="">移动为一级部门</option>
                      {tree.filter(item => item.id !== selectedDepartmentId && !item.pathIds.includes(selectedDepartmentId)).map(item => (
                        <option key={item.id} value={item.id}>{departmentPath(tree, item.id)}</option>
                      ))}
                    </select>
                    <button type="button" disabled={dirty} title={dirty ? "请先保存当前部门资料" : "预览移动影响"} onClick={() => void previewMove()}>预览影响</button>
                    {movePreview && (
                      <div className="organization-move-preview">
                        <span>{movePreview.currentPath}</span><b>→</b><strong>{movePreview.proposedPath}</strong>
                        <small>{movePreview.childDepartmentsAffected} 个下级部门 · {movePreview.aliasesAffected} 个来源别名 · {movePreview.operationalUnitsAffected} 个运营单元</small>
                        <button type="button" disabled={dirty} onClick={() => void confirmMove()}>确认移动</button>
                      </div>
                    )}
                  </section>
                )}
              </>
            )}

            {unitDraft && (
              <>
                <EditorHeading
                  eyebrow={unitDraft.id ? "OPERATIONAL UNIT DETAILS" : "NEW OPERATIONAL UNIT"}
                  title={unitDraft.id ? unitDraft.nameZh : "新增运营单元"}
                  detail="运营单元归属正式部门，但不会成为独立权限范围。"
                />
                <div className="administration-form-grid">
                  <Field label="所属正式部门" required>
                    <select value={unitDraft.departmentId} onChange={event => updateUnit("departmentId", event.target.value)}>
                      {tree.filter(item => item.isActive).map(item => <option key={item.id} value={item.id}>{departmentPath(tree, item.id)}</option>)}
                    </select>
                  </Field>
                  <Field label="运营单元类型">
                    <select value={unitDraft.unitType} onChange={event => updateUnit("unitType", event.target.value as OperationalUnitType)}>
                      <option value="outlet">营业点</option>
                      <option value="venue">场地</option>
                      <option value="restaurant">餐厅</option>
                      <option value="kitchen">厨房</option>
                      <option value="recreation">康乐区域</option>
                      <option value="other">其他</option>
                    </select>
                  </Field>
                  <Field label="中文名称" required>
                    <input value={unitDraft.nameZh} onChange={event => updateUnit("nameZh", event.target.value)} />
                  </Field>
                  <Field label="英文名称">
                    <input value={unitDraft.nameEn} onChange={event => updateUnit("nameEn", event.target.value)} />
                  </Field>
                  <Field label="识别码">
                    <input value={unitDraft.code} onChange={event => updateUnit("code", event.target.value)} />
                  </Field>
                  <Field label="显示顺序">
                    <input type="number" value={unitDraft.sortOrder} onChange={event => updateUnit("sortOrder", Number(event.target.value))} />
                  </Field>
                  <label className="administration-toggle">
                    <span><strong>运营单元使用状态</strong><small>停用不会改变正式部门架构。</small></span>
                    <input type="checkbox" checked={unitDraft.isActive} onChange={event => updateUnit("isActive", event.target.checked)} />
                    <i aria-hidden="true" />
                  </label>
                </div>
                <footer className="administration-editor-actions">
                  <button type="button" className="primary" disabled={phase === "saving" || phase === "conflict" || !dirty} onClick={() => void saveUnit()}>
                    {phase === "saving" ? "保存中…" : "保存运营单元"}
                  </button>
                </footer>
              </>
            )}

            {!departmentDraft && !unitDraft && (
              <div className="administration-empty large">
                <strong>选择一个正式部门</strong>
                <p>在左侧选择部门，或新增第一个正式部门。</p>
              </div>
            )}
          </section>

          <aside className="administration-related-panel">
            <header><span>RELATED UNITS</span><h2>运营单元</h2><p>{selectedDepartment ? `${selectedDepartment.nameZh} 下的业务归属` : "先选择正式部门"}</p></header>
            {departmentUnits.length ? departmentUnits.map(unit => (
              <button type="button" className={selectedUnitId === unit.id ? "selected" : ""} key={unit.id} onClick={() => chooseUnit(unit)}>
                <span><strong>{unit.nameZh}</strong><small>{unit.nameEn || unitTypeLabel(unit.unitType)}</small></span>
                <em>{unit.isActive ? "使用中" : "已停用"}</em>
              </button>
            )) : <p className="administration-quiet-state">当前部门暂无运营单元。</p>}
            <footer>
              <Link href="/positions">维护职位体系</Link>
              <Link href="/accounts">管理部门授权</Link>
            </footer>
          </aside>
        </div>
      </div>
    </AppShell>
  );

  function updateDepartment<K extends keyof DepartmentDraft>(key: K, value: DepartmentDraft[K]) {
    setDepartmentDraft(current => current ? { ...current, [key]: value } : current);
    setPhase("dirty");
    setHasUnsavedChanges(true);
    setStatusMessage("字段已修改，尚未写入服务器");
  }

  function updateUnit<K extends keyof UnitDraft>(key: K, value: UnitDraft[K]) {
    setUnitDraft(current => current ? { ...current, [key]: value } : current);
    setPhase("dirty");
    setHasUnsavedChanges(true);
    setStatusMessage("字段已修改，尚未写入服务器");
  }
}

function EditorHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <header className="administration-editor-heading"><span>{eyebrow}</span><h2>{title}</h2><p>{detail}</p></header>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="administration-field"><span>{label}{required && <em>必填</em>}</span>{children}</label>;
}

function departmentDraftFrom(item: DepartmentNode): DepartmentDraft {
  return {
    id: item.id,
    expectedVersion: item.version,
    parentId: item.parentId,
    nodeType: item.nodeType,
    code: item.code ?? "",
    nameZh: item.nameZh,
    nameEn: item.nameEn ?? "",
    sortOrder: item.sortOrder,
    isActive: item.isActive,
  };
}

function unitDraftFrom(item: OperationalUnit): UnitDraft {
  return {
    id: item.id,
    expectedVersion: item.version,
    departmentId: item.departmentId,
    parentOperationalUnitId: item.parentOperationalUnitId,
    unitType: item.unitType,
    code: item.code ?? "",
    nameZh: item.nameZh,
    nameEn: item.nameEn ?? "",
    sortOrder: item.sortOrder,
    isActive: item.isActive,
  };
}

function validateDepartment(draft: DepartmentDraft) {
  if (!draft.nameZh.trim()) throw new Error("请输入正式部门中文名称");
  if (!draft.id && !draft.code.trim()) throw new Error("请输入部门识别码");
  if (!Number.isFinite(draft.sortOrder)) throw new Error("显示顺序必须是数字");
}

function validateUnit(draft: UnitDraft) {
  if (!draft.departmentId) throw new Error("请选择运营单元所属正式部门");
  if (!draft.nameZh.trim()) throw new Error("请输入运营单元中文名称");
  if (!Number.isFinite(draft.sortOrder)) throw new Error("显示顺序必须是数字");
}

function departmentPath(tree: DepartmentNode[], id: string) {
  const item = tree.find(node => node.id === id);
  return item?.pathIds.map(pathId => tree.find(node => node.id === pathId)?.nameZh).filter(Boolean).join(" › ") ?? "";
}

function nextSortOrder(tree: DepartmentNode[], parentId: string | null) {
  const siblings = tree.filter(item => item.parentId === parentId);
  return Math.max(0, ...siblings.map(item => item.sortOrder)) + 10;
}

function canLeaveDirty(dirty: boolean) {
  return !dirty || window.confirm("当前资料有未保存更改，确定放弃并切换吗？");
}

function isConflict(error: unknown) {
  return error instanceof Error && (
    error.name === "ConflictError" ||
    /已被其他操作更新|已更新|版本/.test(error.message)
  );
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "操作未完成，请重试";
}

function nodeTypeLabel(value: DepartmentNodeType) {
  return {
    division: "大部门",
    department: "部门",
    section: "分部",
    team: "班组",
    other: "其他",
  }[value];
}

function unitTypeLabel(value: OperationalUnitType) {
  return {
    venue: "场地",
    outlet: "营业点",
    kitchen: "厨房",
    restaurant: "餐厅",
    recreation: "康乐区域",
    other: "其他",
  }[value];
}

export default function OrganizationPage() {
  return <ProtectedAppProviders><OrganizationAdministration /></ProtectedAppProviders>;
}
