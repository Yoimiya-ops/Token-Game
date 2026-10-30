import { createElement } from 'react';
import icons from './lucide-icons.json';

export function Icon({ name, size = 16 }: { name: keyof typeof icons; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {(icons[name] as [string, Record<string, string>][]).map(([tag, attributes], index) => createElement(tag, { ...attributes, key: index }))}
  </svg>;
}
