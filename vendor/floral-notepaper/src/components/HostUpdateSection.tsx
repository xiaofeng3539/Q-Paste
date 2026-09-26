import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

type HostStatus = { status: string; version?: string; percent?: number; message?: string };

export function HostUpdateSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<HostStatus>({ status: "idle" });
  const [version, setVersion] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    void api.floralVersion().then(setVersion);
    void api.getUpdateStatus().then(setStatus).catch((reason) => setError(String(reason)));
    return api.onUpdateStatus((next) => { setStatus(next); setError(""); });
  }, []);

  const check = async () => {
    setError("");
    const result = await window.electronAPI!.checkUpdate();
    if (!result.success) setError(result.error ?? "检查更新失败");
  };

  const statusText = status.status === "checking" ? t("settings.update.checking")
    : status.status === "not-available" ? t("settings.update.notAvailable")
    : status.status === "available" ? t("settings.update.available", { version: status.version })
    : status.status === "downloading" ? `${t("settings.update.busy")} ${status.percent ?? 0}%`
    : status.status === "downloaded" ? t("settings.update.downloaded", { version: status.version })
    : status.status === "error" ? status.message ?? "检查更新失败" : "";

  return (
    <section className="space-y-2 border-y border-paper-deep/25 py-3 text-[11px] text-ink-soft">
      <h3 className="font-medium">{t("settings.update.title")}</h3>
      {version && <p>{t("settings.update.currentVersion", { version })}</p>}
      {(error || statusText) && <p role="status">{error || statusText}</p>}
      <div className="flex gap-2">
        <button type="button" className="rounded border border-paper-deep/40 px-2 py-1 hover:bg-paper-warm"
          disabled={status.status === "checking" || status.status === "downloading"}
          onClick={() => void check()}>{t("settings.update.check")}</button>
        {status.status === "downloaded" && <button type="button"
          className="rounded border border-paper-deep/40 px-2 py-1 hover:bg-paper-warm"
          onClick={() => window.dispatchEvent(new Event("floral-host-install-update"))}>
          {t("settings.update.install")}
        </button>}
      </div>
    </section>
  );
}
