import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Compose Tailwind class names, merging conflicts predictably.
 *
 * Usage: cn('px-4 py-2', condition && 'bg-brand', userClassName)
 *
 * Always put consumer-supplied `className` last so it can override defaults.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
