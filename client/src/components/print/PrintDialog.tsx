import React, { useEffect } from 'react';
import { X, Printer } from 'lucide-react';
import { Button } from '@client/src/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@client/src/components/ui/dialog';
import './print.css';

interface PrintDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  landscape?: boolean;
  showAllSizes?: boolean;
  onShowAllSizesChange?: (checked: boolean) => void;
  showAllSizesToggle?: boolean;
  children: React.ReactNode;
}

export const PrintDialog: React.FC<PrintDialogProps> = ({
  open,
  onOpenChange,
  title,
  landscape = false,
  showAllSizes = false,
  onShowAllSizesChange,
  showAllSizesToggle = false,
  children,
}) => {
  useEffect(() => {
    if (open) {
      document.body.classList.add('print-mode');
    } else {
      document.body.classList.remove('print-mode');
    }
    return () => {
      document.body.classList.remove('print-mode');
    };
  }, [open]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={`no-print max-w-5xl max-w-[95vw] max-h-[90vh] overflow-y-auto ${landscape ? 'w-[1100px]' : ''}`}
      >
        <DialogHeader className="no-print">
          <div className="flex items-center justify-between">
            <DialogTitle>{title} - 打印预览</DialogTitle>
            <div className="flex items-center gap-2">
              {showAllSizesToggle && onShowAllSizesChange && (
                <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer mr-2">
                  <input
                    type="checkbox"
                    checked={showAllSizes}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      onShowAllSizesChange(e.target.checked)
                    }
                    className="w-4 h-4 accent-primary"
                  />
                  显示尺码组全部尺码
                </label>
              )}
              <Button onClick={handlePrint}>
                <Printer size={16} className="mr-1" /> 打印
              </Button>
              <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
                <X size={18} />
              </Button>
            </div>
          </div>
        </DialogHeader>
        <div className={`print-area ${landscape ? 'print-landscape' : ''}`}>
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PrintDialog;
