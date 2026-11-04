import { forwardRef, useRef, type TextareaHTMLAttributes } from 'react';

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange' | 'onKeyDown'> & {
  value: string; onDraftChange: (value: string) => void; onSend: () => void; canSend: boolean;
};
export default forwardRef<HTMLTextAreaElement, Props>(function ChatTextInput({ value, onDraftChange, onSend, canSend, onCompositionStart, onCompositionEnd, ...props }, ref) {
  const composing = useRef(false);
  return <textarea {...props} ref={ref} value={value} onChange={event => onDraftChange(event.target.value)}
    onCompositionStart={event => { composing.current = true; onCompositionStart?.(event); }}
    onCompositionEnd={event => { composing.current = false; onCompositionEnd?.(event); }}
    onKeyDown={event => {
      if (event.key !== 'Enter' || event.shiftKey || composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || ('ontouchstart' in window)) return;
      event.preventDefault();
      if (canSend && !props.disabled && !props.readOnly) onSend();
    }} />;
});
