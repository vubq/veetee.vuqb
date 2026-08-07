import type { ClassValue } from 'clsx'
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Merge Tailwind utility classes without losing conditional variants. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
