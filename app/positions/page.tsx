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
  DepartmentNode,
  OfficialPosition,
  PositionFamily,
} from "../repositories/contracts/organization-models.ts";
import {
  loadRuntimeDomainRegistry,
  usesFallbackDomainRegistry,
} from "../repositories/runtime/load-domain-registry.ts";
import type { RuntimeDomainRegistry } from "../repositories/runtime/neon-domain-registry.ts";
import { useAuthSession } from "../state/auth-session";

type FamilyDraft = {
  id: string | null;
  version: number | null;
  code: string;
  nameZh: string;
  nameEn: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
};

type PositionDraft = {
  id: string | null;
  version: number | null;
  positionFamilyId: string | null;
  code: string;
  nameZh: string;
  nameEn: string;
  gradeOrBand: string;
  isActive: boolean;
  departmentIds: string[];
};

function PositionAdministration() {
  const { session } = useAuthSession();
  const [registry, setRegistry] = useState<RuntimeDomainRegistry | null>(null);
  const [propertyId, setPropertyId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [tree, setTree] = useState<DepartmentNode[]>([]);
  const [families, setFamilies] = useState<PositionFamily[]>([]);
  const [positions, setPositions] = useState<OfficialPosition[]>([]);
  const [selectedFamilyId, setSelectedFamilyId] = useState("");
  const [selectedPositionId, setSelectedPositionId] = useState("");
  const [familyDraft, setFamilyDraft] = useState<FamilyDraft | null>(null);
  const [positionDraft, setPositionDraft] = useState<PositionDraft | null>(null);
  const [phase, setPhase] = useState<AdministrationSavePhase>("pristine");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const dirty = hasUnsavedChanges;
  useUnsavedChangesWarning(dirty, "职位资料有未保存更改");
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

  const reload = useCallback(async (preferred?: { familyId?: string; positionId?: string }) => {
    if (!registry) throw new Error("运行时职位来源尚未连接");
    const nextPropertyId = session.propertyId;
    if (!nextPropertyId) throw new Error("当前账号尚未取得酒店职位上下文");
    const [property, nextTree, nextFamilies, nextPositions] = await Promise.all([
      usesFallbackDomainRegistry(registry) && registry.property
        ? registry.property.getProperty(nextPropertyId)
        : Promise.resolve(null),
      registry.department.listTree(nextPropertyId),
      registry.position.listPositionFamilies(nextPropertyId),
      registry.position.listPositions(nextPropertyId),
    ]);
    setPropertyId(nextPropertyId);
    setTenantId(
      property?.identity.tenantId ??
        nextFamilies[0]?.tenantId ??
        nextPositions[0]?.tenantId ??
        nextTree[0]?.tenantId ??
        "",
    );
    setTree(nextTree);
    setFamilies(nextFamilies);
    setPositions(nextPositions);
    setSelectedFamilyId(current => {
      const candidate = preferred?.familyId ?? current;
      return nextFamilies.some(item => item.id === candidate) ? candidate : nextFamilies[0]?.id ?? "";
    });
    setSelectedPositionId(current => {
      const candidate = preferred?.positionId ?? current;
      return nextPositions.some(item => item.id === candidate) ? candidate : nextPositions[0]?.id ?? "";
    });
    return { propertyId: nextPropertyId, families: nextFamilies, positions: nextPositions };
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

  useEffect(() => {
    if (dirty || familyDraft || positionDraft) return;
    const selected = positions.find(item => item.id === selectedPositionId);
    if (selected) queueMicrotask(() => setPositionDraft(positionDraftFrom(selected)));
  }, [dirty, familyDraft, positionDraft, positions, selectedPositionId]);

  const chooseFamily = (family: PositionFamily) => {
    if (!canLeaveDirty(dirty)) return;
    setSelectedFamilyId(family.id);
    setFamilyDraft(familyDraftFrom(family));
    setPositionDraft(null);
    resetSaveState();
  };

  const choosePosition = (position: OfficialPosition) => {
    if (!canLeaveDirty(dirty)) return;
    setSelectedPositionId(position.id);
    setPositionDraft(positionDraftFrom(position));
    setFamilyDraft(null);
    resetSaveState();
  };

  const newFamily = () => {
    if (!canLeaveDirty(dirty)) return;
    setFamilyDraft({
      id: null,
      version: null,
      code: "",
      nameZh: "",
      nameEn: "",
      description: "",
      sortOrder: Math.max(0, ...families.map(item => item.sortOrder)) + 10,
      isActive: true,
    });
    setPositionDraft(null);
    setPhase("dirty");
    setHasUnsavedChanges(true);
    setStatusMessage("正在新增职位族");
  };

  const newPosition = () => {
    if (!canLeaveDirty(dirty)) return;
    setPositionDraft({
      id: null,
      version: null,
      positionFamilyId: selectedFamilyId || null,
      code: "",
      nameZh: "",
      nameEn: "",
      gradeOrBand: "",
      isActive: true,
      departmentIds: [],
    });
    setFamilyDraft(null);
    setPhase("dirty");
    setHasUnsavedChanges(true);
    setStatusMessage("正在新增正式职位");
  };

  const saveFamily = async () => {
    if (!familyDraft || !registry) return;
    try {
      validateFamily(familyDraft);
      setPhase("saving");
      setStatusMessage("正在写入职位族并重新读取服务器状态");
      const saved = await registry.position.savePositionFamily({
        id: familyDraft.id ?? undefined,
        version: familyDraft.version ?? undefined,
        tenantId,
        propertyId,
        code: familyDraft.code,
        nameZh: familyDraft.nameZh,
        nameEn: familyDraft.nameEn,
        description: familyDraft.description,
        sortOrder: familyDraft.sortOrder,
        isActive: familyDraft.isActive,
      });
      await reload({ familyId: saved.id });
      const authoritative = (
        await registry.position.listPositionFamilies(propertyId)
      ).find(item => item.id === saved.id) ?? saved;
      setSelectedFamilyId(saved.id);
      setFamilyDraft(familyDraftFrom(authoritative));
      markSaved("职位族已保存并重新读取");
    } catch (error) {
      markFailure(error);
    }
  };

  const savePosition = async () => {
    if (!positionDraft || !registry) return;
    try {
      validatePosition(positionDraft);
      setPhase("saving");
      setStatusMessage("正在原子保存正式职位与适用部门");
      const saved = await registry.position.savePositionWithDepartments({
        id: positionDraft.id ?? undefined,
        version: positionDraft.version ?? undefined,
        tenantId,
        propertyId,
        positionFamilyId: positionDraft.positionFamilyId,
        code: positionDraft.code,
        nameZh: positionDraft.nameZh,
        nameEn: positionDraft.nameEn,
        gradeOrBand: positionDraft.gradeOrBand,
        isActive: positionDraft.isActive,
        departmentIds: positionDraft.departmentIds,
      });
      await reload({ positionId: saved.id, familyId: saved.positionFamilyId ?? undefined });
      const authoritative = (
        await registry.position.listPositions(propertyId)
      ).find(item => item.id === saved.id) ?? saved;
      setSelectedPositionId(saved.id);
      setPositionDraft(positionDraftFrom(authoritative));
      markSaved("正式职位与适用部门已保存并重新读取");
    } catch (error) {
      markFailure(error);
    }
  };

  const reloadLatest = async () => {
    try {
      const latest = await reload({
        familyId: selectedFamilyId,
        positionId: selectedPositionId,
      });
      const nextFamilies = latest.families;
      const nextPositions = latest.positions;
      if (familyDraft?.id) {
        const latest = nextFamilies.find(item => item.id === familyDraft.id);
        setFamilyDraft(latest ? familyDraftFrom(latest) : null);
      }
      if (positionDraft?.id) {
        const latest = nextPositions.find(item => item.id === positionDraft.id);
        setPositionDraft(latest ? positionDraftFrom(latest) : null);
      }
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
    return <AppShell><div className="page-wrap administration-loading">正在读取职位体系…</div></AppShell>;
  }
  if (!propertyId) {
    return (
      <AppShell>
        <div className="page-wrap administration-page">
          <section className="source-load-failure" role="alert">
            <DataStateBadge state="failed" />
            <h1>职位体系暂时无法读取</h1>
            <p>{statusMessage ?? "系统不会把读取失败解释为零个职位或已完成职位设置。"}</p>
            <button type="button" onClick={() => void retryInitialLoad()}>重新读取</button>
            <Link href="/">返回运营工作台</Link>
          </section>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page-wrap administration-page position-administration-page">
        <header className="administration-hero">
          <div>
            <nav className="administration-breadcrumb" aria-label="页面路径">
              <Link href="/">运营工作台</Link><span>›</span><strong>职位体系</strong>
            </nav>
            <span>HOTEL POSITION FOUNDATION</span>
            <h1>职位体系</h1>
            <p>维护酒店正式职位族、职位与适用部门。职位是员工归属和后续培训对象的管理基础，不会自动创建后台账号。</p>
          </div>
          <aside>
            <DataStateBadge state={sourceState} />
            <strong>{positions.filter(item => item.isActive).length}</strong>
            <span>有效正式职位</span>
            <small>{families.filter(item => item.isActive).length} 个职位族</small>
          </aside>
        </header>

        <section className="administration-command-bar">
          <AdministrationSaveState
            phase={phase}
            savedAt={savedAt}
            message={statusMessage}
            onRetry={() => void (dirty ? (familyDraft ? saveFamily() : savePosition()) : reloadLatest())}
            onReload={() => void reloadLatest()}
          />
          <div>
            <button type="button" onClick={newFamily}>新增职位族</button>
            <button type="button" onClick={newPosition}>新增正式职位</button>
          </div>
        </section>

        <div className="position-admin-layout">
          <aside className="position-family-panel">
            <header><span>POSITION FAMILIES</span><h2>职位族</h2><p>用于统一管理相近岗位。</p></header>
            {families.map(family => (
              <button type="button" className={selectedFamilyId === family.id ? "selected" : ""} key={family.id} onClick={() => chooseFamily(family)}>
                <span><strong>{family.nameZh}</strong><small>{family.nameEn || family.code}</small></span>
                <em>{positions.filter(item => item.positionFamilyId === family.id).length}</em>
              </button>
            ))}
            {!families.length && <p className="administration-quiet-state">尚未建立职位族。</p>}
          </aside>

          <section className="position-catalog-panel">
            <header><span>OFFICIAL POSITIONS</span><h2>正式职位</h2><p>选择职位查看适用部门。</p></header>
            <div className="position-catalog-list">
              {positions.map(position => (
                <button type="button" className={`${selectedPositionId === position.id ? "selected" : ""} ${position.isActive ? "" : "inactive"}`} key={position.id} onClick={() => choosePosition(position)}>
                  <span><strong>{position.nameZh}</strong><small>{position.nameEn || position.code}</small></span>
                  <em>{familyName(families, position.positionFamilyId)}</em>
                  <b>{position.departmentIds.length ? `${position.departmentIds.length} 个部门` : "全酒店通用"}</b>
                </button>
              ))}
              {!positions.length && (
                <div className="administration-empty">
                  <strong>尚未建立正式职位</strong>
                  <p>职位可在启用后继续完善，不会阻挡酒店进入日常工作台。</p>
                  <button type="button" onClick={newPosition}>新增正式职位</button>
                </div>
              )}
            </div>
          </section>

          <section className="administration-editor-panel position-editor-panel">
            {familyDraft && (
              <>
                <EditorHeading eyebrow={familyDraft.id ? "POSITION FAMILY DETAILS" : "NEW POSITION FAMILY"} title={familyDraft.id ? familyDraft.nameZh : "新增职位族"} detail="职位族用于归纳相近职位，不直接授予权限。" />
                <div className="administration-form-grid">
                  <Field label="中文名称" required><input value={familyDraft.nameZh} onChange={event => updateFamily("nameZh", event.target.value)} /></Field>
                  <Field label="英文名称"><input value={familyDraft.nameEn} onChange={event => updateFamily("nameEn", event.target.value)} /></Field>
                  <Field label="职位族识别码" required><input value={familyDraft.code} onChange={event => updateFamily("code", event.target.value)} /></Field>
                  <Field label="显示顺序"><input type="number" value={familyDraft.sortOrder} onChange={event => updateFamily("sortOrder", Number(event.target.value))} /></Field>
                  <Field label="说明"><textarea rows={4} value={familyDraft.description} onChange={event => updateFamily("description", event.target.value)} /></Field>
                  <label className="administration-toggle">
                    <span><strong>职位族使用状态</strong><small>停用后保留历史引用。</small></span>
                    <input type="checkbox" checked={familyDraft.isActive} onChange={event => updateFamily("isActive", event.target.checked)} /><i aria-hidden="true" />
                  </label>
                </div>
                <footer className="administration-editor-actions">
                  <button type="button" className="primary" disabled={!dirty || phase === "saving" || phase === "conflict"} onClick={() => void saveFamily()}>{phase === "saving" ? "保存中…" : "保存职位族"}</button>
                </footer>
              </>
            )}

            {positionDraft && (
              <>
                <EditorHeading eyebrow={positionDraft.id ? "OFFICIAL POSITION DETAILS" : "NEW OFFICIAL POSITION"} title={positionDraft.id ? positionDraft.nameZh : "新增正式职位"} detail="正式职位与适用部门在一次操作中保存，避免出现部分更新。" />
                <div className="administration-form-grid">
                  <Field label="中文名称" required><input value={positionDraft.nameZh} onChange={event => updatePosition("nameZh", event.target.value)} /></Field>
                  <Field label="英文名称"><input value={positionDraft.nameEn} onChange={event => updatePosition("nameEn", event.target.value)} /></Field>
                  <Field label="职位识别码" required><input value={positionDraft.code} onChange={event => updatePosition("code", event.target.value)} /></Field>
                  <Field label="职位族"><select value={positionDraft.positionFamilyId ?? ""} onChange={event => updatePosition("positionFamilyId", event.target.value || null)}><option value="">暂不归入职位族</option>{families.filter(item => item.isActive || item.id === positionDraft.positionFamilyId).map(item => <option value={item.id} key={item.id}>{item.nameZh}</option>)}</select></Field>
                  <Field label="职级 / Band"><input value={positionDraft.gradeOrBand} onChange={event => updatePosition("gradeOrBand", event.target.value)} /></Field>
                  <label className="administration-toggle">
                    <span><strong>职位使用状态</strong><small>停用后不能用于新的员工归属。</small></span>
                    <input type="checkbox" checked={positionDraft.isActive} onChange={event => updatePosition("isActive", event.target.checked)} /><i aria-hidden="true" />
                  </label>
                </div>
                <section className="position-department-scope">
                  <header><strong>适用部门</strong><p>不选择时表示全酒店通用；选择后仅用于所列正式部门。</p></header>
                  <div>
                    {tree.filter(item => item.isActive).map(department => (
                      <label key={department.id} style={{ paddingLeft: 14 + department.depth * 18 }}>
                        <input type="checkbox" checked={positionDraft.departmentIds.includes(department.id)} onChange={() => toggleDepartment(department.id)} />
                        <span><strong>{department.nameZh}</strong><small>{departmentPath(tree, department.id)}</small></span>
                      </label>
                    ))}
                  </div>
                </section>
                <footer className="administration-editor-actions">
                  <button type="button" className="primary" disabled={!dirty || phase === "saving" || phase === "conflict"} onClick={() => void savePosition()}>{phase === "saving" ? "保存中…" : "保存正式职位"}</button>
                </footer>
              </>
            )}
          </section>
        </div>

        <section className="administration-boundary-note">
          <div><span>员工与账号边界</span><strong>职位不会创建应用账号</strong></div>
          <p>普通员工继续只作为员工主数据记录。只有被任命为部门培训负责人的人员，才会在“账号与部门授权”中单独获得后台账号。</p>
          <Link href="/accounts">前往账号与部门授权</Link>
        </section>
      </div>
    </AppShell>
  );

  function updateFamily<K extends keyof FamilyDraft>(key: K, value: FamilyDraft[K]) {
    setFamilyDraft(current => current ? { ...current, [key]: value } : current);
    setPhase("dirty");
    setHasUnsavedChanges(true);
    setStatusMessage("字段已修改，尚未写入服务器");
  }

  function updatePosition<K extends keyof PositionDraft>(key: K, value: PositionDraft[K]) {
    setPositionDraft(current => current ? { ...current, [key]: value } : current);
    setPhase("dirty");
    setHasUnsavedChanges(true);
    setStatusMessage("字段已修改，尚未写入服务器");
  }

  function toggleDepartment(departmentId: string) {
    setPositionDraft(current => {
      if (!current) return current;
      const departmentIds = current.departmentIds.includes(departmentId)
        ? current.departmentIds.filter(id => id !== departmentId)
        : [...current.departmentIds, departmentId];
      return { ...current, departmentIds };
    });
    setPhase("dirty");
    setHasUnsavedChanges(true);
    setStatusMessage("适用部门已修改，尚未写入服务器");
  }
}

function EditorHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return <header className="administration-editor-heading"><span>{eyebrow}</span><h2>{title}</h2><p>{detail}</p></header>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="administration-field"><span>{label}{required && <em>必填</em>}</span>{children}</label>;
}

function familyDraftFrom(item: PositionFamily): FamilyDraft {
  return { id: item.id, version: item.version, code: item.code, nameZh: item.nameZh, nameEn: item.nameEn ?? "", description: item.description ?? "", sortOrder: item.sortOrder, isActive: item.isActive };
}

function positionDraftFrom(item: OfficialPosition): PositionDraft {
  return { id: item.id, version: item.version, positionFamilyId: item.positionFamilyId, code: item.code, nameZh: item.nameZh, nameEn: item.nameEn ?? "", gradeOrBand: item.gradeOrBand ?? "", isActive: item.isActive, departmentIds: [...item.departmentIds] };
}

function validateFamily(draft: FamilyDraft) {
  if (!draft.nameZh.trim()) throw new Error("请输入职位族中文名称");
  if (!draft.code.trim()) throw new Error("请输入职位族识别码");
}

function validatePosition(draft: PositionDraft) {
  if (!draft.nameZh.trim()) throw new Error("请输入正式职位中文名称");
  if (!draft.code.trim()) throw new Error("请输入职位识别码");
  if (new Set(draft.departmentIds).size !== draft.departmentIds.length) throw new Error("适用部门不能重复");
}

function familyName(families: PositionFamily[], id: string | null) {
  return families.find(item => item.id === id)?.nameZh ?? "未归类";
}

function departmentPath(tree: DepartmentNode[], id: string) {
  const item = tree.find(node => node.id === id);
  return item?.pathIds.map(pathId => tree.find(node => node.id === pathId)?.nameZh).filter(Boolean).join(" › ") ?? "";
}

function canLeaveDirty(dirty: boolean) {
  return !dirty || window.confirm("当前资料有未保存更改，确定放弃并切换吗？");
}

function isConflict(error: unknown) {
  return error instanceof Error && (error.name === "ConflictError" || /已被其他操作更新|已更新|版本/.test(error.message));
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "操作未完成，请重试";
}

export default function PositionsPage() {
  return <ProtectedAppProviders><PositionAdministration /></ProtectedAppProviders>;
}
