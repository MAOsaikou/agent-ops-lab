export function SealStamp({
  hash,
  at,
  label,
}: {
  readonly hash: string;
  readonly at: string;
  readonly label: string;
}): React.JSX.Element {
  const time = at.slice(5, 16).replace("T", " ");
  return (
    <div className="stamp-in flex items-center gap-3 rounded-xl border-2 border-seal-500/70 bg-seal-100/40 px-3.5 py-2.5">
      <div className="-rotate-6 rounded-md border-2 border-seal-500 px-2 py-1 text-center">
        <div className="text-[13px] font-bold leading-none tracking-widest text-seal-600">已锁定</div>
        <div className="mt-0.5 text-[8.5px] leading-none tracking-wider text-seal-500">LOCKED</div>
      </div>
      <div className="min-w-0">
        <div className="truncate text-[12px] font-medium text-ink-800">{label}</div>
        <div className="truncate font-mono text-[10.5px] text-ink-500">
          {hash.slice(0, 24)} · {time}
        </div>
      </div>
    </div>
  );
}