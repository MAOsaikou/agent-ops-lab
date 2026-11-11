import { Check, Loader2, PlugZap, Save, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { ActionButton, Pill } from "./Primitives.js";
import { Field, Toggle } from "./Field.js";
import { fetchLlmSettings, saveLlmSettings, testLlmSettings, type LlmSettingsView } from "../lib/agentops.js";

export function ModelSettingsPanel({
  onClose,
  onChanged,
}: {
  readonly onClose: () => void;
  readonly onChanged: (view: LlmSettingsView) => void;
}): React.JSX.Element {
  const [view, setView] = useState<LlmSettingsView | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [baseUrl, setBaseUrl] = useState("https://api.deepseek.com");
  const [model, setModel] = useState("deepseek-flash");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ readonly ok: boolean; readonly text: string } | null>(null);

  useEffect(() => {
    void fetchLlmSettings()
      .then((next) => {
        setView(next);
        setEnabled(next.enabled);
        setBaseUrl(next.baseUrl);
        setModel(next.model);
        onChanged(next);
      })
      .catch(() => {
        setMessage({ ok: false, text: "读取模型配置失败，可能是服务端未重启到新版本。" });
      });
  }, [onChanged]);

  const persist = async (): Promise<boolean> => {
    setBusy(true);
    try {
      const patch = apiKey.length > 0 ? { enabled, baseUrl, model, apiKey } : { enabled, baseUrl, model };
      const next = await saveLlmSettings(patch);
      setView(next);
      setEnabled(next.enabled);
      setBaseUrl(next.baseUrl);
      setModel(next.model);
      setApiKey("");
      onChanged(next);
      setMessage({ ok: true, text: "配置已保存。" });
      return true;
    } catch (caught) {
      setMessage({ ok: false, text: caught instanceof Error ? caught.message : "保存失败" });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const runTest = async (): Promise<void> => {
    setBusy(true);
    try {
      const patch = apiKey.length > 0 ? { enabled, baseUrl, model, apiKey } : { enabled, baseUrl, model };
      const next = await saveLlmSettings(patch);
      setView(next);
      setEnabled(next.enabled);
      setBaseUrl(next.baseUrl);
      setModel(next.model);
      setApiKey("");
      onChanged(next);
      const result = await testLlmSettings();
      setMessage({ ok: result.ok, text: result.ok ? `已保存并测试通过：${result.detail}` : result.detail });
    } catch (caught) {
      setMessage({ ok: false, text: caught instanceof Error ? caught.message : "测试失败" });
    } finally {
      setBusy(false);
    }
  };

  const clearKey = async (): Promise<void> => {
    setBusy(true);
    try {
      const next = await saveLlmSettings({ clearKey: true, enabled: false, model, baseUrl });
      setView(next);
      setEnabled(next.enabled);
      setModel(next.model);
      setApiKey("");
      onChanged(next);
      setMessage({ ok: true, text: "已清除密钥并关闭模型节点。" });
    } catch (caught) {
      setMessage({ ok: false, text: caught instanceof Error ? caught.message : "清除失败" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-paper-300 bg-paper-50 p-4 shadow-card">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold">模型节点配置</span>
            {view === null ? null : <Pill tone={view.active ? "jade" : view.enabled ? "seal" : "plain"}>{view.active ? `已启用 · ${view.model}` : view.enabled ? "已开启但未生效" : "未启用（规则模式）"}</Pill>}
            {view?.source === "env" ? <Pill tone="ochre">来自环境变量</Pill> : null}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-500">密钥保存在本机，页面只显示后四位。启用后会向所选服务发送评审资料。</p>
        </div>
        <button type="button" aria-label="关闭模型配置" onClick={onClose} className="rounded-lg p-1 text-ink-400 hover:bg-paper-100 hover:text-ink-900"><X className="h-4 w-4" /></button>
      </div>

      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        <div className="sm:col-span-2"><Toggle label="启用模型会审、提问和文案" hint="采购、定价与运营独立提案，主持质询后定向修订；数值和风控仍由本地验证。" checked={enabled} onChange={setEnabled} /></div>
        <Field label="Base URL" hint="DeepSeek 官方地址" value={baseUrl} inputMode="text" onChange={setBaseUrl} placeholder="https://api.deepseek.com" />
        <Field label="模型名" hint="DeepSeek Flash" value={model} inputMode="text" onChange={setModel} placeholder="deepseek-flash" />
        <Field label="API Key" hint={view?.hasKey === true ? `已有 ${view.keyHint}，留空则不变` : "本地模型可填 local"} value={apiKey} inputMode="text" onChange={setApiKey} placeholder="sk-…" />
        <div className="flex flex-wrap items-end gap-2">
          <ActionButton size="sm" onClick={() => { void persist(); }} disabled={busy}><Save className="h-3.5 w-3.5" />保存</ActionButton>
          <ActionButton size="sm" variant="ghost" onClick={() => { void runTest(); }} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}测试并保存</ActionButton>
          <ActionButton size="sm" variant="ghost" onClick={() => { void clearKey(); }} disabled={busy}><Trash2 className="h-3.5 w-3.5" />清除密钥</ActionButton>
        </div>
      </div>

      {message === null ? null : (
        <p className={`mt-2.5 flex items-start gap-1.5 rounded-lg px-3 py-2 text-[11.5px] ${message.ok ? "bg-jade-100/60 text-jade-600" : "bg-seal-100 text-seal-600"}`}>
          {message.ok ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : null}
          {message.text}
        </p>
      )}
      {view === null ? null : <p className="mt-2 text-[10.5px] leading-relaxed text-ink-400">{view.note}</p>}
    </div>
  );
}
