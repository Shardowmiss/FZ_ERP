import * as React from 'react';

import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@client/src/components/ui/tooltip';

export interface OverflowTooltipTextProps extends React.HTMLAttributes<HTMLSpanElement> {
  text: string;
}

/**
 * Displays truncated inline text and shows a tooltip with the full content when overflowed.
 *
 * IMPORTANT: The root element must ALWAYS be a TooltipProvider wrapper.
 * We must NEVER toggle the root node type between a bare <span> and a Tooltip-wrapped tree,
 * because ResizeObserver fires synchronously outside React's render phase and can cause
 * "Failed to execute 'removeChild' on 'Node'" errors when the root DOM structure changes
 * during React's commit phase (React 19 concurrent rendering).
 */
export function OverflowTooltipText({
  text,
  className,
  ...props
}: OverflowTooltipTextProps) {
  const textRef = React.useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = React.useState(false);

  const checkOverflow = React.useCallback(() => {
    const el = textRef.current;
    if (!el) return;
    setIsOverflowing(el.scrollWidth > el.clientWidth + 1);
  }, []);

  React.useEffect(() => {
    const el = textRef.current;
    if (!el) return;

    checkOverflow();

    const observer = new ResizeObserver(() => {
      checkOverflow();
    });
    observer.observe(el);

    const handleResize = (): void => {
      checkOverflow();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [checkOverflow, text]);

  const textNode = (
    <span
      ref={textRef}
      className={cn('inline-block truncate', className)}
      {...props}
    >
      {text}
    </span>
  );

  return (
    <TooltipProvider>
      <Tooltip open={isOverflowing ? undefined : false} delayDuration={80}>
        <TooltipTrigger asChild>{textNode}</TooltipTrigger>
        <TooltipContent
          sideOffset={4}
          className="bg-[rgb(31_35_41)] text-white ring-0"
        >
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
