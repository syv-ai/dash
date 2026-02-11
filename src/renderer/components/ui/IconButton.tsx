import React from 'react';

type IconButtonSize = 'sm' | 'md';

interface IconButtonProps {
  onClick: (e: React.MouseEvent) => void;
  title: string;
  variant?: 'default' | 'destructive';
  size?: IconButtonSize;
  className?: string;
  children: React.ReactNode;
}

const variantStyles = {
  default: 'hover:bg-accent text-foreground/70 hover:text-foreground',
  destructive: 'hover:bg-destructive/15 text-foreground/70 hover:text-destructive',
} as const;

const sizeStyles = {
  sm: 'p-0.5',
  md: 'p-1.5',
} as const;

export function IconButton({
  onClick,
  title,
  variant = 'default',
  size = 'md',
  className = '',
  children,
}: IconButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md transition-colors duration-150 ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      title={title}
    >
      {children}
    </button>
  );
}
