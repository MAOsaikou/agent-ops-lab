import React, { Component, type ErrorInfo, type ReactNode } from "react";

export type ErrorBoundaryProps = {
  readonly children: ReactNode;
  readonly onReset?: () => void;
};

type ErrorBoundaryState = {
  readonly hasError: boolean;
  readonly error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = {
    hasError: false,
    error: null,
  };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log technical error for diagnostics while keeping root intact
    console.error("ErrorBoundary caught render exception:", error, errorInfo);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center p-6 text-ink-900">
          <div
            data-testid="render-crash"
            className="flex w-full flex-col gap-4 rounded-2xl border border-seal-500/35 bg-paper-50 p-6 shadow-card"
          >
            <div className="flex items-center gap-2.5 text-seal-600">
              <span className="font-display text-[17px] font-semibold">
                页面渲染遇到意外错误，已兜底拦截
              </span>
            </div>
            <p className="text-[13px] leading-relaxed text-ink-600">
              评审台在渲染此卷宗时抛出异常。你可以点击下方按钮回到工作台，这不会丢失历史记录。
            </p>
            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="inline-flex items-center justify-center rounded-xl bg-seal-600 px-4 py-2 text-[13px] font-semibold text-paper-50 shadow-sm transition hover:bg-seal-700 active:scale-[0.98]"
              >
                回到工作台
              </button>
            </div>
            {this.state.error !== null && (
              <details className="mt-3 border-t border-paper-200/80 pt-3 text-[11px] text-ink-400 font-mono">
                <summary className="cursor-pointer select-none hover:text-ink-600">
                  查看技术错误详情
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded bg-paper-100 p-2.5 text-ink-800 break-words">
                  {this.state.error.stack || this.state.error.message}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
