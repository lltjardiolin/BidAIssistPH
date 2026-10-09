import type { ButtonHTMLAttributes } from 'react';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost'; size?: 'md' | 'lg' };

const VARIANT = {
  primary: 'bg-accent text-white hover:bg-accent-hover disabled:bg-sunk disabled:text-muted',
  secondary: 'bg-surface text-ink border border-line-strong hover:border-ink disabled:text-muted',
  ghost: 'text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent',
};

export function Button({ variant = 'primary', size = 'md', className = '', type = 'button', ...rest }: Props) {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center gap-2 rounded-control text-[14.5px] font-semibold disabled:cursor-not-allowed ${variant === 'ghost' ? 'px-0' : 'px-4'} ${size === 'lg' ? 'min-h-11' : 'min-h-10'} ${VARIANT[variant]} ${className}`}
      {...rest}
    />
  );
}
