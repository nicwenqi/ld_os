# Recovery E0-C — Business Input Package

> **用途：** 供项目负责人填写 E0-C 准入所需的最小业务输入。此表收集候选范围和人类批准，不创建任何系统事实，也不替代 [E0-C 决策锁](./e0-c-entry-decision-lock.md) 或 [Human Approval Record](./e0-c-human-approval-record.md)。

## 状态语义

| Status | Meaning | System consequence |
| --- | --- | --- |
| **Candidate** | 提议中的人、范围、数据源或培训案例；尚未获得所需人类批准。 | 不授权任何环境、数据或事实操作。 |
| **Approved** | 所需 Owner 已在受控审批记录中确认该输入适合进入 E0-C 准备。 | 仅可用于 E0-C 的已批准、非 Production 准备工作；不创建业务事实。 |
| **Effective** | 仅在后续独立批准的受控领域流程完成后，才可成为真实、可引用的系统事实或数据结果。 | 当前 E0-C 阶段不得填写为 Effective。 |

**No Go 规则：** 任何必填行不是 `Approved`，或必需 Evidence 缺失、冲突、过期、不可验证时，E0-C 必须保持 `No Go`。`Approved` 不等于 `Effective`，更不等于 Production、员工导入或培训事实授权。

## 1. 技术责任人

| Input | Owner | Value | Evidence | Approval Status |
| --- | --- | --- | --- | --- |
| Database Owner | `[项目负责人填写]` | `[姓名、组织、职责]` | `[对 lint warning 处置责任的签署或审批引用]` | `Candidate / Approved / Effective` |
| Release Owner | `[项目负责人填写]` | `[姓名、组织、职责]` | `[E0-A release manifest 责任确认]` | `Candidate / Approved / Effective` |
| Evidence Reviewer | `[项目负责人填写]` | `[姓名、组织、职责]` | `[E0-A/E0-B 证据审阅责任确认]` | `Candidate / Approved / Effective` |
| Existing lint warning disposition | `Database Owner` | `[blocking / controlled exception / remediation required]` | `[本地复现、分类、测试或处置计划的脱敏引用]` | `Candidate / Approved / Effective` |

**填写提示：** lint warning 的 `Effective` 状态不应在本包中使用；若需要修复或 migration，必须另行取得明确批准。

## 2. 业务责任人

| Input | Owner | Value | Evidence | Approval Status |
| --- | --- | --- | --- | --- |
| Pilot Property Owner | `[项目负责人填写]` | `[姓名、酒店/组织、授权职责]` | `[酒店方 Pilot 范围授权引用]` | `Candidate / Approved / Effective` |
| Hotel L&D Manager | `[项目负责人填写]` | `[姓名、组织、L&D 决策职责]` | `[基线预览与业务范围审批引用]` | `Candidate / Approved / Effective` |
| Data Owner | `[项目负责人填写]` | `[姓名、组织、数据治理职责]` | `[数据源、隐私与保留责任确认]` | `Candidate / Approved / Effective` |
| Department Training Responsible Person（如委派） | `Hotel L&D Manager` | `[姓名；仅引用现有授权账号/范围，不创建账号]` | `[现有角色、物业成员关系、部门范围确认]` | `Candidate / Approved / Effective` |

## 3. Pilot 酒店与部门范围

| Input | Owner | Value | Evidence | Approval Status |
| --- | --- | --- | --- | --- |
| Pilot hotel property | `Pilot Property Owner` | `[官方酒店属性名称；不填凭据、URL 或内部连接信息]` | `[物业上下文/酒店方授权引用]` | `Candidate / Approved / Effective` |
| Official department branch | `Pilot Property Owner + Hotel L&D Manager` | `[一个官方部门分支]` | `[已批准组织架构引用]` | `Candidate / Approved / Effective` |
| Descendant scope rule | `Hotel L&D Manager` | `[包含 / 不包含；明确规则]` | `[授权范围确认]` | `Candidate / Approved / Effective` |
| Cohort definition | `Hotel L&D Manager` | `[有限 cohort、纳入依据、预计人数、排除条件]` | `[范围审阅记录]` | `Candidate / Approved / Effective` |
| Scope limitation | `Pilot Property Owner` | `[确认不产生酒店级 KPI、Health、Forecast、Risk 或完整性结论]` | `[签署或审批引用]` | `Candidate / Approved / Effective` |

## 4. 员工基线授权

| Input | Owner | Value | Evidence | Approval Status |
| --- | --- | --- | --- | --- |
| Workbook source | `Data Owner` | `[来源系统/责任人、截至日期、授权交接引用；不嵌入工作簿]` | `[私有授权交接记录]` | `Candidate / Approved / Effective` |
| Private handling | `Data Owner` | `[私有 Storage、允许审阅者、保留/删除与脱敏规则]` | `[隐私处理确认]` | `Candidate / Approved / Effective` |
| Field boundary | `Data Owner + Hotel L&D Manager` | `员工主数据；排除 training history、CTC/GTC completion、公式派生培训字段` | `[字段审阅记录]` | `Candidate / Approved / Effective` |
| Zero-write preview authorization | `Hotel L&D Manager` | `[仅允许检查、字段识别、问题处理与预览；不提交]` | `[授权声明]` | `Candidate / Approved / Effective` |
| Baseline status | `Hotel L&D Manager + Data Owner` | `Full / Restricted / Cannot start` | `[review-version/hash、问题摘要、范围影响说明]` | `Candidate / Approved / Effective` |
| Restricted baseline safeguard | `Hotel L&D Manager` | `[仅限已批准 clean cohort；未解决行与酒店级结论均排除]` | `[受限范围批准引用]` | `Candidate / Approved / Effective` |

**不可省略：** 未确认、缺失或冲突的部门、职位、身份、日期和员工状态必须保留为待处理，不得猜测、默认或因一次工作簿缺席而停用员工。员工导入不创建 Auth 用户或后台账号。

## 5. 首个培训案例

| Input | Owner | Value | Evidence | Approval Status |
| --- | --- | --- | --- | --- |
| Candidate business case | `Pilot Property Owner + Hotel L&D Manager` | `消防安全年度培训` 或 `[其他候选]` | `[业务目的和有限范围确认]` | `Candidate / Approved / Effective` |
| Candidate applicability statement | `Hotel L&D Manager` | `[为什么此有限 cohort 需要被后续评估；不创建 Eligibility Evaluation]` | `[业务规则说明]` | `Candidate / Approved / Effective` |
| Candidate learning-method direction | `Hotel L&D Manager` | `[仅作为后续讨论：课程、外部证书、考核或等效认可]` | `[业务说明]` | `Candidate / Approved / Effective` |
| Candidate delivery constraints | `Pilot Property Owner` | `[运营窗口、部门限制、场地/培训师可用性；不创建 Plan 或 Session]` | `[运营确认]` | `Candidate / Approved / Effective` |

**事实边界：** 本节中的任何内容即使是 `Approved`，也仍然只是业务输入；在后续单独授权和 D1/D2/D3/D4 受控流程完成前，不得成为 Requirement Version、Course Version、Plan、Session、Attendance 或 Completion Evidence。

## 6. 最终输入完整性检查

| Check | Owner | Value | Evidence | Approval Status |
| --- | --- | --- | --- | --- |
| 所有必需 Owner 已具名且职责无冲突 | `Project Sponsor` | `Yes / No` | `[Human Approval Record 引用]` | `Candidate / Approved / Effective` |
| 所有候选输入均有可验证 Evidence | `Evidence Reviewer` | `Yes / No` | `[审阅记录引用]` | `Candidate / Approved / Effective` |
| E0-C 是否保持 No Go | `Project Sponsor` | `Yes — until all mandatory rows are Approved` | `[最终决定引用]` | `Candidate / Approved / Effective` |
| 是否授权任何 Production、migration、导入或培训事实 | `Project Sponsor` | `No` | `本包不授权此类动作` | `Candidate / Approved / Effective` |

## 非授权确认

本业务输入包不授权 Production connection、migration execution、employee import、Course creation、Requirement creation、Session creation、Attendance creation、Completion creation、部署、DNS/环境变量修改、KPI、Health、Forecast、Risk、Feedback、AI 或 D5 工作。

在最终 Human Approval Record 完整、所有必要行获批、并取得下一步单独的明确用户授权前，E0-C 始终保持 **No Go**。
