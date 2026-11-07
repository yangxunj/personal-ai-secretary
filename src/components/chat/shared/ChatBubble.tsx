import type { ReactNode } from 'react';

export default function ChatBubble({ role, children }: { role: 'user' | 'assistant'; children: ReactNode }) {
  const mine = role === 'user';
  return <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
    <div className={`max-w-[85%] min-w-0 rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed break-words ${
      mine ? 'bg-brand-500 text-white rounded-br-md' : 'surface border rounded-bl-md'}`}
      style={mine ? undefined : { borderColor: 'var(--border)' }}>{children}</div>
  </div>;
}
