import { useEffect, useRef, useState } from "react";

import { clauseForAnswer } from "../../../src/templates/agentops/compose.js";
import type { Preflight } from "../../../src/templates/agentops/preflight.js";
import { prepareMerchantIntake } from "../lib/agentops.js";

export function MerchantIntake({ task, busy, onTaskChange, onStart }: {
  readonly task: string;
  readonly busy: boolean;
  readonly onTaskChange: (value: string) => void;
  readonly onStart: (task: string) => Promise<void>;
}): React.JSX.Element {
  const [result, setResult] = useState<Preflight | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const currentTask = useRef(task);
  currentTask.current = task;
  const controller = useRef<AbortController | null>(null);
  const starting = useRef(false);
  const requesting = useRef(false);
  useEffect(() => {
    controller.current?.abort();
    setPending(false);
    requesting.current = false;
    setConfirmed(false);
    setAnswers({});
    setError(null);
  }, [task]);
  useEffect(() => () => controller.current?.abort(), []);
  const active = result?.task === task ? result : null;
  const prepare = async (): Promise<void> => {
    if (requesting.current || pending || busy || task.trim() === "") return;
    requesting.current = true;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const captured = task;
    setPending(true);
    setError(null);
    setConfirmed(false);
    try {
      const next = await prepareMerchantIntake(captured, request.signal);
      if (!request.signal.aborted && captured === currentTask.current) setResult(next);
    } catch (caught) {
      if (!request.signal.aborted && captured === currentTask.current) setError(caught instanceof Error ? caught.message : "资料检查失败，请重试");
    } finally {
      if (controller.current === request) { setPending(false); requesting.current = false; }
    }
  };
  const supplement = async (): Promise<void> => {
    if (active === null || busy || pending || requesting.current) return;
    let next = task;
    for (const question of active.questions) {
      const answer = clauseForAnswer(question.id, answers[question.id] ?? "");
      if (!answer.ok) { setError(`${question.ask} ${answer.error}`); return; }
      // Put the confirmed answer first so an earlier invalid value cannot shadow it.
      next = `${answer.clause}。${next}`;
    }
    const captured = task;
    requesting.current = true;
    const request = new AbortController();
    controller.current = request;
    setPending(true);
    try {
      const inspected = await prepareMerchantIntake(next, request.signal);
      if (!request.signal.aborted && currentTask.current === captured) {
        onTaskChange(next);
        setResult(inspected);
        setAnswers({});
        setConfirmed(false);
        setError(null);
      }
    } catch (caught) {
      if (!request.signal.aborted) setError(caught instanceof Error ? caught.message : "补充失败，请重试");
    } finally {
      if (controller.current === request) { setPending(false); requesting.current = false; }
    }
  };
  return (
    <section aria-label="商家资料助手" className="rounded-xl border border-jade-600/25 bg-paper-50 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-display text-sm font-semibold text-ink-900">先问清资料，再开评审</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink-600">没有链接也能开始。写下商品和已知成本，助手会只问缺少的信息。</p>
        </div>
        <button type="button" data-testid="prepare-intake" disabled={busy || pending || task.trim() === ""} onClick={() => { void prepare(); }} className="rounded-lg bg-jade-600 px-3 py-2 text-xs font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jade-600 disabled:opacity-50">
          {pending ? "正在检查资料…" : "让助手问我"}
        </button>
      </div>
      {error === null ? null : <p role="alert" className="mt-2 text-xs text-seal-600">{error}</p>}
      {active === null ? null : (
        <div data-testid="intake-preflight" className="mt-3 border-t border-paper-300 pt-3">
          <p className="text-xs text-ink-500">{active.mode === "live" ? `模型追问（${active.model ?? ""}）` : active.mode === "fallback" ? "规则追问 · 模型回退" : "规则追问"}：{active.note}</p>
          {active.known.length === 0 ? null : <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-3">{active.known.map((field) => <div key={field.label}><dt className="text-ink-500">{field.label}</dt><dd className="break-words font-medium text-ink-900">{field.value}</dd></div>)}</dl>}
          {active.ready ? <p data-testid="intake-ready" className="mt-3 text-sm font-semibold text-jade-600">必需资料已齐，可以开评审</p> : (
            <div className="mt-3">
              <p className="text-sm font-semibold text-ink-900">还差 {active.questions.length} 项，先一起补上</p>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">{active.questions.map((question) => <div key={question.id}>
                <label htmlFor={`preflight-${question.id}`} className="block text-xs font-medium text-ink-800">{question.ask}</label>
                <input id={`preflight-${question.id}`} data-testid={`preflight-answer-${question.id}`} disabled={busy} value={answers[question.id] ?? ""} onChange={(event) => setAnswers((prev) => ({ ...prev, [question.id]: event.target.value }))} inputMode={question.id === "name" ? "text" : "decimal"} className="mt-1 w-full rounded-lg border border-paper-300 bg-paper-100 px-3 py-2 text-sm text-ink-900 outline-none focus:ring-2 focus:ring-jade-600" />
                <p className="mt-1 text-[11px] leading-relaxed text-ink-500">{question.why}</p>
              </div>)}</div>
              <button type="button" data-testid="intake-supplement" disabled={busy || pending} onClick={() => { void supplement(); }} className="mt-3 rounded-lg bg-ink-900 px-3 py-2 text-xs text-paper-50 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50">补充资料并核对</button>
            </div>
          )}
          <div className="mt-3 rounded-lg bg-ochre-100/50 p-3 text-xs text-ink-700">
            <p className="font-medium">以下是试算假设，可在上方描述或按项填写中修改</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">{active.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul>
          </div>
          {active.ready ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-start gap-2 text-xs leading-relaxed text-ink-700"><input type="checkbox" data-testid="intake-confirm" checked={confirmed} disabled={busy} onChange={(event) => setConfirmed(event.target.checked)} className="mt-0.5 accent-jade-600" />我已核对资料，并同意按以上假设试算</label>
            <button type="button" data-testid="intake-start" disabled={!confirmed || busy || pending} onClick={() => {
              if (starting.current || !confirmed || currentTask.current !== active.task) return;
              starting.current = true;
              void onStart(active.task).finally(() => { starting.current = false; });
            }} className="rounded-lg bg-seal-600 px-4 py-2 text-xs font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-seal-600 disabled:opacity-50">开始会签评审</button>
          </div> : null}
        </div>
      )}
    </section>
  );
}
