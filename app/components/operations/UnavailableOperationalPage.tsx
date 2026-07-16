"use client";

import Link from "next/link";
import { AppShell } from "../shell/AppShell";
import { DataStateBadge } from "./DataStateBadge";

type UnavailableOperationalPageProps = {
  title: string;
  englishTitle: string;
  managementQuestion: string;
  explanation: string;
  requiredFacts: readonly string[];
  availableNow?: readonly string[];
  returnHref: string;
  returnLabel: string;
};

export function UnavailableOperationalPage({
  title,
  englishTitle,
  managementQuestion,
  explanation,
  requiredFacts,
  availableNow = [],
  returnHref,
  returnLabel,
}: UnavailableOperationalPageProps) {
  return (
    <AppShell>
      <div className="page-wrap unavailable-operational-page">
        <header className="unavailable-page-heading">
          <div>
            <span>TRAINING OPERATIONS · DATA BOUNDARY</span>
            <h1>{title}</h1>
            <p>{englishTitle}</p>
          </div>
          <DataStateBadge state="unavailable" />
        </header>

        <section className="unavailable-judgment" aria-labelledby="unavailable-judgment-title">
          <div className="unavailable-judgment-copy">
            <span>当前管理判断</span>
            <h2 id="unavailable-judgment-title">尚未接入真实数据，当前无法作出运营判断</h2>
            <p>{explanation}</p>
            <Link href={returnHref}>{returnLabel}</Link>
          </div>
          <aside>
            <span>本页应回答</span>
            <strong>{managementQuestion}</strong>
            <p>真实来源接入前，系统不会用演示值、零值或原型动作替代运营事实。</p>
          </aside>
        </section>

        <div className="unavailable-evidence-grid">
          <section aria-labelledby="required-facts-heading">
            <header>
              <span>REQUIRED EVIDENCE</span>
              <h2 id="required-facts-heading">形成可信判断所需的事实</h2>
            </header>
            <ol>
              {requiredFacts.map(fact => (
                <li key={fact}>
                  <span aria-hidden="true" />
                  {fact}
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="current-boundary-heading">
            <header>
              <span>CURRENT BOUNDARY</span>
              <h2 id="current-boundary-heading">当前可用范围</h2>
            </header>
            {availableNow.length > 0 ? (
              <ul>
                {availableNow.map(item => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : (
              <p>此模块当前没有可用于酒店运营判断的真实事实。</p>
            )}
            <small>后续接入必须保留来源、更新时间、适用范围与数据完整性说明。</small>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
