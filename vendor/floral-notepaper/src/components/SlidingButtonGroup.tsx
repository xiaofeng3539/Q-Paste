import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface SlidingButtonGroupProps<T extends string> {
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
  buttonClassName?: string;
}

export function SlidingButtonGroup<T extends string>({
  options,
  value,
  onChange,
  className = "",
  buttonClassName = "h-7",
}: SlidingButtonGroupProps<T>) {
  const buttonsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0, height: 0 });
  const [animated, setAnimated] = useState(false);

  useLayoutEffect(() => {
    const btn = buttonsRef.current.get(value);
    if (!btn) return;
    setPos({
      left: btn.offsetLeft,
      top: btn.offsetTop,
      width: btn.offsetWidth,
      height: btn.offsetHeight,
    });
  }, [value]);

  useEffect(() => {
    requestAnimationFrame(() => setAnimated(true));
  }, []);

  const transition = animated
    ? "left 0.25s cubic-bezier(0.22,1,0.36,1), top 0.25s cubic-bezier(0.22,1,0.36,1), width 0.25s cubic-bezier(0.22,1,0.36,1), height 0.25s cubic-bezier(0.22,1,0.36,1)"
    : "none";

  return (
    <div
      className={`relative flex items-center gap-1 bg-segment-track rounded-lg p-[2px] border border-paper-deep/60 ${className}`}
    >
      <div
        className="absolute rounded-md bg-segment-thumb shadow-[0_1px_3px_var(--color-shadow-deep)] ring-1 ring-paper-deep/55 pointer-events-none sliding-highlight"
        style={{ left: pos.left, top: pos.top, width: pos.width, height: pos.height, transition }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          ref={(el) => {
            if (el) buttonsRef.current.set(option.value, el);
            else buttonsRef.current.delete(option.value);
          }}
          type="button"
          onClick={() => onChange(option.value)}
          className={`relative z-[1] flex-1 rounded-md text-[11px] transition-colors duration-200 cursor-pointer ${buttonClassName} ${
            value === option.value
              ? "text-bamboo font-semibold"
              : "text-ink-faint hover:text-ink"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
