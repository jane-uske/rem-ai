"use client";

type GlobalErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalErrorPage({ error, reset }: GlobalErrorPageProps) {
  return (
    <html lang="zh-CN">
      <body className="min-h-dvh bg-black text-white">
        <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-4 px-6 py-16">
          <h1 className="text-2xl font-semibold">应用启动失败</h1>
          <p className="text-sm text-neutral-300">
            Next.js 触发了全局错误边界。先重试一次；如果还不行，再检查浏览器控制台和服务端日志。
          </p>
          <pre className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-950 p-4 text-xs text-neutral-300">
            {error.message || "Unknown error"}
          </pre>
          <div>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black"
            >
              重试
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
