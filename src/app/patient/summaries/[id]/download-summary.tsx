"use client";

export function DownloadSummary({ filename, body }: { filename: string; body: string }) {
  function download() {
    const file = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button className="text-sm font-semibold text-brand-teal" type="button" onClick={download}>
      Download summary
    </button>
  );
}
