import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Send, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

export interface DocPageProps {
  title: string;
  docNo?: string;
  status?: string;
  statusColor?: string;
  backPath: string;
  viewOnly?: boolean;
  onSave?: () => void;
  onSubmit?: () => void;
  onPrint?: () => void;
  header: React.ReactNode;
  children: React.ReactNode;
  extraActions?: React.ReactNode;
  saving?: boolean;
  submitting?: boolean;
}

const statusColorMap: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  pending: 'bg-orange-100 text-orange-600',
  approved: 'bg-green-100 text-green-600',
  completed: 'bg-blue-100 text-blue-600',
};

const statusLabelMap: Record<string, string> = {
  draft: '草稿',
  pending: '待审',
  approved: '已审',
  completed: '已完成',
};

const DocPage: React.FC<DocPageProps> = ({
  title,
  docNo,
  status,
  statusColor,
  backPath,
  viewOnly = false,
  onSave,
  onSubmit,
  onPrint,
  header,
  children,
  extraActions,
  saving = false,
  submitting = false,
}) => {
  const navigate = useNavigate();

  const resolvedStatusColor = statusColor ?? (status ? statusColorMap[status] : '');
  const resolvedStatusLabel = status ? (statusLabelMap[status] ?? status) : '';

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* Top action bar */}
      <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(backPath)}
            className="gap-1"
          >
            <ArrowLeft size={16} />
            返回
          </Button>
          <div className="h-5 w-px bg-gray-200" />
          <h1 className="text-lg font-semibold text-gray-800">{title}</h1>
          {docNo && (
            <span className="text-sm text-gray-500 font-mono">{docNo}</span>
          )}
          {status && (
            <Badge
              variant="outline"
              className={`text-xs px-2 py-0.5 ${resolvedStatusColor}`}
            >
              {resolvedStatusLabel}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {extraActions}
          {onPrint && (
            <Button variant="outline" size="sm" onClick={onPrint}>
              <Printer size={16} />
              打印
            </Button>
          )}
          {!viewOnly && onSave && (
            <Button size="sm" onClick={onSave} disabled={saving}>
              <Save size={16} />
              {saving ? '保存中...' : '保存'}
            </Button>
          )}
          {!viewOnly && onSubmit && (
            <Button size="sm" variant="default" onClick={onSubmit} disabled={submitting}>
              <Send size={16} />
              {submitting ? '提交中...' : '提交审核'}
            </Button>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto bg-[#f5f7fa] p-5 space-y-4">
        <Card className="p-5">
          <h2 className="text-sm font-medium text-gray-700 mb-4">表头信息</h2>
          {header}
        </Card>
        <Card className="p-5 flex-1">
          {children}
        </Card>
      </div>
    </div>
  );
};

export default DocPage;
