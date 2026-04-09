"use client";

import { useEffect } from "react";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error("[app error]", error);
  }, [error]);

  return (
    <main className="min-h-dvh bg-neutral-950 px-6 py-16 text-neutral-100">
      <div className="mx-auto flex max-w-2xl flex-col gap-4">
        <h1 className="text-2xl font-semibold">页面渲染失败</h1>
        <p className="text-sm text-neutral-300">
          开发环境捕获到了一个运行时错误。可以先重试一次；如果仍然失败，再看控制台或服务端日志。
        </p>
        <pre className="overflow-x-auto rounded-xl border border-neutral-800 bg-black/30 p-4 text-xs text-neutral-300">
          {error.message || "Unknown error"}
        </pre>
        <div>
          <button
            type="button"
            onClick={reset}
            className="rounded-lg bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-950"
          >
            重试
          </button>
        </div>
      </div>
    </main>
  );
}
