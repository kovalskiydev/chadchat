import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-sm border border-border text-sm font-medium uppercase tracking-[0.12em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-zinc-900 text-zinc-100 shadow-wire hover:bg-zinc-800 hover:text-white",
        ghost:
          "border-transparent bg-transparent text-muted-foreground hover:bg-zinc-900 hover:text-zinc-100",
        outline:
          "bg-transparent text-zinc-200 shadow-wire hover:bg-zinc-900 hover:text-white",
      },
      size: {
        default: "h-10 px-4 py-2",
        icon: "h-10 w-10",
        wireLarge: "h-44 w-full text-lg sm:h-52",
        wireMedium: "h-24 w-full text-base",
        wireSmall: "h-14 w-full text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button };
