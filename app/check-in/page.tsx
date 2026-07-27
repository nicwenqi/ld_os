"use client";

import { useMemo, useRef, useState } from "react";
import { createRepositoryRegistry } from "../repositories/registry.ts";

type CheckInState =
  | "ready"
  | "submitting"
  | "accepted"
  | "already_recorded"
  | "unable_to_check_in";

export default function PublicAttendanceCheckInPage() {
  const registry = useMemo(() => createRepositoryRegistry(), []);
  const [employeeNumber, setEmployeeNumber] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [state, setState] = useState<CheckInState>("ready");
  const [message, setMessage] = useState(
    "请输入员工编号与姓名。系统只会在本场冻结参与人范围内进行受限匹配。",
  );
  const idempotencyKey = useRef("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    // Fragment tokens are never included in the initial HTTP request, server
    // logs or page metadata.
    const token = decodeURIComponent(
      window.location.hash.replace(/^#/, ""),
    );
    if (!registry.attendance || !token) {
      setState("unable_to_check_in");
      setMessage("当前签到链接无法使用，请联系培训负责人。");
      return;
    }
    idempotencyKey.current ||= crypto.randomUUID();
    setState("submitting");
    try {
      const result = await registry.attendance.submitPublicCheckIn({
        token,
        employeeNumber,
        employeeName,
        idempotencyKey: idempotencyKey.current,
      });
      setState(result.outcome);
      setMessage(result.message);
    } catch {
      setState("unable_to_check_in");
      setMessage("无法完成签到，请核对信息或联系培训负责人。");
    }
  };

  const finished =
    state === "accepted" || state === "already_recorded";

  return (
    <main className="public-check-in">
      <section>
        <header>
          <div className="public-hotel-mark" aria-hidden="true">澜</div>
          <span>HOTEL TRAINING CHECK-IN</span>
          <h1>{finished ? "签到信息已提交" : "培训现场签到"}</h1>
          <p>
            {finished
              ? "最终出勤仍需培训负责人核对。本页面不会进入酒店管理系统。"
              : "此页面只用于当前场次的受限身份匹配与签到 Observation 提交。"}
          </p>
        </header>
        {!finished ? (
          <form onSubmit={event => void submit(event)}>
            <label>
              员工编号
              <input
                value={employeeNumber}
                onChange={event => setEmployeeNumber(event.target.value)}
                autoComplete="off"
                inputMode="text"
                required
              />
            </label>
            <label>
              姓名
              <input
                value={employeeName}
                onChange={event => setEmployeeName(event.target.value)}
                autoComplete="name"
                required
              />
            </label>
            <button
              type="submit"
              disabled={
                state === "submitting" ||
                !employeeNumber.trim() ||
                !employeeName.trim()
              }
            >
              {state === "submitting" ? "正在提交…" : "提交签到信息"}
            </button>
          </form>
        ) : (
          <div className="public-check-in-result" aria-hidden="true">✓</div>
        )}
        <p
          className={`public-check-in-message state-${state}`}
          role="status"
        >
          {message}
        </p>
        <footer>
          不创建员工账号 · 不开放后台导航 · 不自动判定出席
        </footer>
      </section>
    </main>
  );
}
