import * as React from "react";
import { cn } from "@/lib/utils";

interface TableContainerProps {
  children: React.ReactNode;
  className?: string;
}

export const TableContainer: React.FC<TableContainerProps> = ({
  children,
  className,
}) => (
  <div
    className={cn(
      "overflow-x-auto w-full border border-gray-200 rounded-lg",
      className
    )}
  >
    {children}
  </div>
);
