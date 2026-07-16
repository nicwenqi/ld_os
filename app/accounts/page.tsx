"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AdministrationSaveState,
  savedTime,
  type AdministrationSavePhase,
  useUnsavedChangesWarning,
} from "../components/administration/AdministrationSaveState";
import { DataStateBadge } from "../components/operations/DataStateBadge";
import { AppShell } from "../components/shell/AppShell";
import { ProtectedAppProviders } from "../providers";
import type { DepartmentNode } from "../repositories/contracts/organization-models.ts";
import { createRepositoryRegistry } from "../repositories/registry.ts";
import {
  accountRoleLabel,
  createBackendAccount,
  loadBackendAccounts,
  resetBackendAccountPassword,
  updateBackendAccount,
  type BackendAccountCollection,
  type BackendAccountDraft,
  type BackendAccountStatus,
  type BackendAccountSummary,
  type DepartmentScopeDraft,
  type HotelBackendRoleCode,
} from "../services/account-administration.ts";
import { useAuthSession } from "../state/auth-session";

type AccountEditor = {
  accountId: string | null;
  expectedVersion: number | null;
  isCurrentAccount: boolean;
  displayName: string;
  loginId: string;
  temporaryPassword: string;
  roleCode: HotelBackendRoleCode;
  status: BackendAccountStatus;
  mustChangePassword: boolean;
  scopes: DepartmentScopeDraft[];
};

function AccountAdministration() {
  const registry = useMemo(() => createRepositoryRegistry(), []);
  const { session } = useAuthSession();
  const [tree, setTree] = useState<DepartmentNode[]>([]);
  const [collection, setCollection] = useState<BackendAccountCollection | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [editor, setEditor] = useState<AccountEditor | null>(null);
  const [phase, setPhase] = useState<AdministrationSavePhase>("pristine");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirmation, setResetConfirmation] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const dirty = hasUnsavedChanges;
  const resetDirty = resetOpen && Boolean(resetPassword || resetConfirmation);
  const pageDirty = dirty || resetDirty;
  useUnsavedChangesWarning(pageDirty, "账号与部门授权有未保存更改");

  const reload = useCallback(async (preferredAccountId?: string) => {
    const nextPropertyId =
      registry.environment.dataMode === "mock"
        ? (await registry.property.resolveContext("training-demo.example.test"))?.propertyId
        : session.propertyId;
    if (!nextPropertyId) throw new Error("当前账号尚未取得酒店账号管理上下文");
    const [nextTree, nextCollection] = await Promise.all([
      registry.department.listTree(nextPropertyId),
      loadBackendAccounts(),
    ]);
    setTree(nextTree);
    setCollection(nextCollection);
    setSelectedAccountId(current => {
      const candidate = preferredAccountId ?? current;
      return nextCollection.accounts.some(item => item.accountId === candidate)
        ? candidate
        : nextCollection.accounts[0]?.accountId ?? "";
    });
    return nextCollection;
  }, [registry, session.propertyId]);

  useEffect(() => {
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
  }, [reload]);

  useEffect(() => {
    if (dirty || editor?.accountId === selectedAccountId) return;
    const account = collection?.accounts.find(item => item.accountId === selectedAccountId);
    queueMicrotask(() => setEditor(account ? editorFrom(account) : null));
  }, [collection, dirty, editor?.accountId, selectedAccountId]);

  const chooseAccount = (account: BackendAccountSummary) => {
    if (!canLeaveDirty(pageDirty)) return;
    setSelectedAccountId(account.accountId);
    setEditor(editorFrom(account));
    closeResetPanel();
    resetSaveState();
  };

  const newAccount = () => {
    if (!canLeaveDirty(pageDirty)) return;
    setSelectedAccountId("");
    closeResetPanel();
    setEditor({
      accountId: null,
      expectedVersion: null,
      isCurrentAccount: false,
      displayName: "",
      loginId: "",
      temporaryPassword: "",
      roleCode: "department_training_admin",
      status: "active",
      mustChangePassword: true,
      scopes: [],
    });
    setPhase("dirty");
    setHasUnsavedChanges(true);
    setStatusMessage("正在新增后台账号；普通员工不会自动获得账号");
  };

  const save = async () => {
    if (!editor) return;
    try {
      setPhase("saving");
      setStatusMessage("正在保存账号、角色与部门授权，并重新读取服务器状态");
      const draft: BackendAccountDraft = {
        displayName: editor.displayName,
        loginId: editor.loginId,
        temporaryPassword: editor.accountId ? undefined : editor.temporaryPassword,
        roleCode: editor.roleCode,
        status: editor.status,
        scopes: editor.roleCode === "property_ld_manager" ? [] : editor.scopes,
      };
      const next = editor.accountId
        ? await updateBackendAccount(
            editor.accountId,
            editor.expectedVersion!,
            draft,
          )
        : await createBackendAccount(draft);
      setCollection(next);
      const authoritative =
        next.accounts.find(item =>
          editor.accountId
            ? item.accountId === editor.accountId
            : item.loginId.toLowerCase() === editor.loginId.trim().toLowerCase(),
        ) ?? null;
      if (!authoritative) throw new Error("账号已保存，但重新读取结果不完整");
      setSelectedAccountId(authoritative.accountId);
      setEditor(editorFrom(authoritative));
      closeResetPanel();
      setPhase("saved");
      setHasUnsavedChanges(false);
      setSavedAt(savedTime());
      setStatusMessage("账号、角色与部门授权已保存并重新读取");
    } catch (error) {
      setPhase(isConflict(error) ? "conflict" : "failed");
      setStatusMessage(message(error));
    }
  };

  const reloadLatest = async () => {
    try {
      const next = await reload(editor?.accountId ?? selectedAccountId);
      const account = next.accounts.find(item => item.accountId === (editor?.accountId ?? selectedAccountId));
      setEditor(account ? editorFrom(account) : null);
      closeResetPanel();
      resetSaveState();
    } catch (error) {
      setPhase("failed");
      setStatusMessage(message(error));
    }
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
  const resetAccountPassword = async () => {
    if (!editor?.accountId || editor.isCurrentAccount) return;
    setResetError(null);
    if (resetPassword !== resetConfirmation) {
      setResetError("两次输入的初始密码不一致");
      return;
    }
    setResetting(true);
    try {
      const next = await resetBackendAccountPassword(
        editor.accountId,
        editor.expectedVersion!,
        resetPassword,
      );
      const authoritative = next.accounts.find(item => item.accountId === editor.accountId);
      if (!authoritative) throw new Error("密码已更新，但账号重新读取结果不完整");
      setCollection(next);
      setEditor(editorFrom(authoritative));
      closeResetPanel();
      setPhase("saved");
      setSavedAt(savedTime());
      setStatusMessage("初始密码已更新；该账号下次登录必须设置新密码");
    } catch (error) {
      setResetError(message(error));
    } finally {
      setResetting(false);
    }
  };

  function closeResetPanel() {
    setResetOpen(false);
    setResetPassword("");
    setResetConfirmation("");
    setResetError(null);
  }

  const accounts = collection?.accounts ?? [];
  const activeManagers = accounts.filter(
    item => item.roleCode === "property_ld_manager" && item.status === "active",
  ).length;
  const departmentOwners = accounts.filter(
    item => item.roleCode === "department_training_admin" && item.status === "active",
  ).length;
  const sourceState = collection?.source === "real" ? "real" : "demo";

  if (loading) {
    return <AppShell><div className="page-wrap administration-loading">正在读取后台账号与授权…</div></AppShell>;
  }
  if (!collection) {
    return (
      <AppShell>
        <div className="page-wrap administration-page">
          <section className="source-load-failure" role="alert">
            <DataStateBadge state="failed" />
            <h1>后台账号与授权暂时无法读取</h1>
            <p>{statusMessage ?? "系统不会以空账号或演示授权替代读取失败。"}</p>
            <button type="button" onClick={() => void retryInitialLoad()}>重新读取</button>
            <Link href="/">返回运营工作台</Link>
          </section>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="page-wrap administration-page account-administration-page">
        <header className="administration-hero">
          <div>
            <nav className="administration-breadcrumb" aria-label="页面路径">
              <Link href="/">运营工作台</Link><span>›</span><strong>账号与部门授权</strong>
            </nav>
            <span>BACKEND ACCESS ADMINISTRATION</span>
            <h1>账号与部门授权</h1>
            <p>只管理酒店学习与发展经理及部门培训负责人。普通员工继续作为员工主数据记录，不会自动获得后台账号。</p>
          </div>
          <aside>
            <DataStateBadge state={sourceState} />
            <strong>{accounts.length}</strong>
            <span>后台账号记录</span>
            <small>{activeManagers} 位经理 · {departmentOwners} 位部门负责人</small>
          </aside>
        </header>

        <section className="administration-command-bar">
          <AdministrationSaveState
            phase={phase}
            savedAt={savedAt}
            message={statusMessage}
            onRetry={() => void (dirty ? save() : reloadLatest())}
            onReload={() => void reloadLatest()}
          />
          <div><button type="button" onClick={newAccount}>新增后台账号</button></div>
        </section>

        <div className="account-admin-layout">
          <section className="account-list-panel">
            <header><span>AUTHORIZED ACCOUNTS</span><h2>后台账号</h2><p>用户 ID 由酒店域名和服务器授权共同解析。</p></header>
            {accounts.map(account => (
              <button type="button" className={`${selectedAccountId === account.accountId ? "selected" : ""} ${account.status}`} key={account.accountId} onClick={() => chooseAccount(account)}>
                <span className="account-list-avatar" aria-hidden="true">{account.displayName.slice(0, 1)}</span>
                <span><strong>{account.displayName}</strong><small>{account.loginId} · {accountRoleLabel(account.roleCode)}</small></span>
                <em>{account.status === "active" ? "使用中" : account.status === "suspended" ? "已暂停" : "已停用"}</em>
              </button>
            ))}
            {!accounts.length && <div className="administration-empty"><strong>尚无可管理账号</strong><p>酒店必须始终保留至少一位活动学习与发展经理。</p></div>}
          </section>

          <section className="administration-editor-panel account-editor-panel">
            {editor ? (
              <>
                <header className="administration-editor-heading">
                  <span>{editor.accountId ? "ACCOUNT AND SCOPE DETAILS" : "NEW BACKEND ACCOUNT"}</span>
                  <h2>{editor.accountId ? editor.displayName : "新增后台账号"}</h2>
                  <p>{editor.isCurrentAccount ? "这是当前登录账号；不能自行更改角色或停用自己。" : "角色和部门范围会在保存时一起校验并写入。"}</p>
                </header>
                <div className="administration-form-grid">
                  <Field label="显示名称" required><input value={editor.displayName} onChange={event => update("displayName", event.target.value)} /></Field>
                  <Field label="用户 ID" required><input autoCapitalize="none" autoCorrect="off" value={editor.loginId} onChange={event => update("loginId", event.target.value)} /></Field>
                  {!editor.accountId && (
                    <Field label="临时密码" required>
                      <input type="password" minLength={12} autoComplete="new-password" value={editor.temporaryPassword} onChange={event => update("temporaryPassword", event.target.value)} />
                      <small>至少 12 位，并同时包含字母和数字。内部认证标识不会显示给使用者。</small>
                    </Field>
                  )}
                  <Field label="应用角色" required>
                    <select disabled={editor.isCurrentAccount} value={editor.roleCode} onChange={event => {
                      const roleCode = event.target.value as HotelBackendRoleCode;
                      setEditor(current => current ? { ...current, roleCode, scopes: roleCode === "property_ld_manager" ? [] : current.scopes } : current);
                      markDirty("角色已修改，尚未写入服务器");
                    }}>
                      <option value="property_ld_manager">酒店学习与发展经理</option>
                      <option value="department_training_admin">部门培训负责人</option>
                    </select>
                    {editor.isCurrentAccount && <small>为防止自行扩大或移除权限，当前账号角色不可在此修改。</small>}
                  </Field>
                  {editor.accountId ? (
                    <Field label="账号状态">
                      <select disabled={editor.isCurrentAccount} value={editor.status} onChange={event => update("status", event.target.value as BackendAccountStatus)}>
                        <option value="active">使用中</option>
                        <option value="suspended">暂停登录</option>
                        <option value="disabled">停用账号</option>
                      </select>
                      {editor.isCurrentAccount && <small>当前登录账号不能停用自己。</small>}
                    </Field>
                  ) : (
                    <div className="administration-field account-initial-status">
                      <span>初始账号状态</span>
                      <strong>创建后立即可用</strong>
                      <small>如暂不允许登录，请创建后将账号状态改为“暂停登录”。</small>
                    </div>
                  )}
                </div>

                {editor.accountId && (
                  <section className="account-password-administration">
                    <div>
                      <span>LOGIN PASSWORD</span>
                      <strong>{editor.isCurrentAccount ? "我的登录密码" : "账号密码重置"}</strong>
                      <p>
                        {editor.isCurrentAccount
                          ? collection.source === "real"
                            ? "当前登录账号可进入独立安全页面修改密码。"
                            : "本地验证资料不会创建或修改真实认证密码。"
                          : collection.source !== "real"
                            ? "本地验证资料不会创建或修改真实认证密码。"
                            : editor.mustChangePassword
                            ? "该账号正在等待使用者设置新密码。"
                            : "重置后生成新的初始密码，并要求使用者首次登录后修改。"}
                      </p>
                    </div>
                    {editor.isCurrentAccount && collection.source === "real" ? (
                      <Link href="/change-password">修改我的密码</Link>
                    ) : editor.isCurrentAccount ? (
                      <button type="button" disabled title="本地验证资料不会修改真实登录密码">修改我的密码</button>
                    ) : (
                      <button
                        type="button"
                        disabled={dirty || collection.source !== "real"}
                        title={collection.source !== "real" ? "本地验证资料不会修改真实登录密码" : dirty ? "请先保存账号资料" : "重置此账号的登录密码"}
                        onClick={() => setResetOpen(true)}
                      >
                        重置登录密码
                      </button>
                    )}
                  </section>
                )}

                {resetOpen && editor.accountId && !editor.isCurrentAccount && (
                  <section className="account-password-reset-panel">
                    <header>
                      <span>RESET INITIAL PASSWORD</span>
                      <h3>为 {editor.displayName} 设置新的初始密码</h3>
                      <p>保存后，使用者必须在进入工作台前设置自己的新密码。</p>
                    </header>
                    <div className="administration-form-grid">
                      <Field label="新的初始密码" required>
                        <input type="password" autoComplete="new-password" minLength={12} value={resetPassword} onChange={event => setResetPassword(event.target.value)} />
                        <small>至少 12 位，并同时包含字母和数字。</small>
                      </Field>
                      <Field label="再次输入" required>
                        <input type="password" autoComplete="new-password" minLength={12} value={resetConfirmation} onChange={event => setResetConfirmation(event.target.value)} />
                      </Field>
                    </div>
                    {resetError && <div className="account-password-reset-error" role="alert">{resetError}</div>}
                    <footer>
                      <button type="button" disabled={resetting} onClick={() => {
                        if (!resetDirty || window.confirm("放弃尚未保存的初始密码？")) closeResetPanel();
                      }}>取消</button>
                      <button type="button" className="primary" disabled={resetting || !resetPassword || !resetConfirmation} onClick={() => void resetAccountPassword()}>
                        {resetting ? "正在重置…" : "保存新的初始密码"}
                      </button>
                    </footer>
                  </section>
                )}

                {editor.roleCode === "department_training_admin" ? (
                  <section className="department-scope-editor">
                    <header>
                      <span>AUTHORIZED DEPARTMENT SCOPE</span>
                      <h3>部门授权范围</h3>
                      <p>至少选择一个活动正式部门；是否包含下级部门必须逐项明确。</p>
                    </header>
                    <div>
                      {tree.filter(item => item.isActive).map(department => {
                        const scope = editor.scopes.find(item => item.departmentId === department.id);
                        return (
                          <article key={department.id} style={{ marginLeft: department.depth * 16 }}>
                            <label>
                              <input type="checkbox" checked={Boolean(scope)} onChange={() => toggleScope(department.id)} />
                              <span><strong>{department.nameZh}</strong><small>{departmentPath(tree, department.id)}</small></span>
                            </label>
                            {scope && (
                              <label className="scope-descendants">
                                <input type="checkbox" checked={scope.includeDescendants} onChange={event => setIncludeDescendants(department.id, event.target.checked)} />
                                <span>包含下级部门</span>
                              </label>
                            )}
                          </article>
                        );
                      })}
                    </div>
                    {!tree.some(item => item.isActive) && <p className="administration-quiet-state">尚未建立活动正式部门，暂时不能创建部门培训负责人。</p>}
                  </section>
                ) : (
                  <section className="manager-scope-explanation">
                    <span>酒店范围</span>
                    <strong>整个当前酒店物业</strong>
                    <p>酒店学习与发展经理不使用部门范围。系统会保护最后一位活动经理，避免酒店失去管理入口。</p>
                  </section>
                )}

                <footer className="administration-editor-actions">
                  <button type="button" className="primary" disabled={!dirty || phase === "saving" || phase === "conflict"} onClick={() => void save()}>{phase === "saving" ? "保存中…" : editor.accountId ? "保存账号与授权" : "创建后台账号"}</button>
                </footer>
              </>
            ) : (
              <div className="administration-empty large"><strong>选择一个后台账号</strong><p>查看其角色、状态和部门授权范围，或新增账号。</p></div>
            )}
          </section>

          <aside className="account-policy-panel">
            <span>ACCESS POLICY</span>
            <h2>访问边界</h2>
            <dl>
              <div><dt>酒店学习与发展经理</dt><dd>整个当前酒店；管理设置、组织、账号与启用。</dd></div>
              <div><dt>部门培训负责人</dt><dd>仅明确授权的正式部门分支；不能自行扩大范围。</dd></div>
              <div><dt>普通员工</dt><dd>不登录后台；不因员工资料更新而自动创建账号。</dd></div>
            </dl>
            <Link href="/organization">核对正式部门架构</Link>
            {collection.source === "real"
              ? <Link href="/change-password">修改我的密码</Link>
              : <span className="account-policy-unavailable">本地验证不修改真实登录密码</span>}
          </aside>
        </div>

        <section className="administration-boundary-note">
          <div><span>安全保护</span><strong>账号、角色与范围一起校验</strong></div>
          <p>服务器拒绝跨酒店操作、重复范围、非活动部门范围、自行扩大权限，以及移除最后一位活动酒店学习与发展经理。</p>
        </section>
      </div>
    </AppShell>
  );

  function update<K extends keyof AccountEditor>(key: K, value: AccountEditor[K]) {
    setEditor(current => current ? { ...current, [key]: value } : current);
    markDirty("字段已修改，尚未写入服务器");
  }

  function markDirty(detail: string) {
    setPhase("dirty");
    setHasUnsavedChanges(true);
    setStatusMessage(detail);
  }

  function toggleScope(departmentId: string) {
    setEditor(current => {
      if (!current) return current;
      const existing = current.scopes.some(item => item.departmentId === departmentId);
      const scopes = existing
        ? current.scopes.filter(item => item.departmentId !== departmentId)
        : [...current.scopes, { departmentId, includeDescendants: false }];
      return { ...current, scopes };
    });
    markDirty("部门授权范围已修改，尚未写入服务器");
  }

  function setIncludeDescendants(departmentId: string, includeDescendants: boolean) {
    setEditor(current => current ? {
      ...current,
      scopes: current.scopes.map(scope =>
        scope.departmentId === departmentId ? { ...scope, includeDescendants } : scope,
      ),
    } : current);
    markDirty("下级部门授权已修改，尚未写入服务器");
  }
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="administration-field"><span>{label}{required && <em>必填</em>}</span>{children}</label>;
}

function editorFrom(account: BackendAccountSummary): AccountEditor {
  return {
    accountId: account.accountId,
    expectedVersion: account.version,
    isCurrentAccount: account.isCurrentAccount,
    displayName: account.displayName,
    loginId: account.loginId,
    temporaryPassword: "",
    roleCode: account.roleCode,
    status: account.status,
    mustChangePassword: account.mustChangePassword,
    scopes: account.scopes.map(scope => ({
      departmentId: scope.departmentId,
      includeDescendants: scope.includeDescendants,
    })),
  };
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

export default function AccountsPage() {
  return <ProtectedAppProviders><AccountAdministration /></ProtectedAppProviders>;
}
