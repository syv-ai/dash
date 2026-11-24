import React from 'react';
import { Check } from 'lucide-react';

interface CircleCheckProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  className?: string;
}

export function CircleCheck({ checked, onChange, label, className = '' }: CircleCheckProps) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`flex items-center gap-2.5 group text-left ${className}`}
    >
      <span
        className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 transition-colors duration-150 ${
          checked ? 'border-btn bg-btn' : 'border-ink-3 bg-transparent group-hover:border-ink-2'
        }`}
      >
        {checked && <Check size={10} strokeWidth={3} className="text-btn-ink" />}
      </span>
      <span className="text-base text-ink-2 group-hover:text-ink transition-colors">{label}</span>
    </button>
  );
}
