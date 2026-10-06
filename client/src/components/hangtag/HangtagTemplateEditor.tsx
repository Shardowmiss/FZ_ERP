/* ------------------------------------------------------------------ *
 * 吊牌模板设计器（拖拽式）
 *
 * 能力：
 *   ① 左侧字段调色板（来自 FIELD_CATALOG），可拖拽 / 点击 放入画布
 *   ② 画布：绝对定位放置字段块，支持指针拖动移动、右下角拖拽缩放、点选
 *   ③ 右侧属性面板：标签 / 字号 / 加粗 / 对齐 / 颜色 / 前后缀 / 显示 / 删除
 *   ④ 纸张设置：预设（A4/A5/A6/各类标签）/ 自定义宽高 / 方向 / 内边距 / 背景
 *   ⑤ 标题 / 副标题 / 页脚 文本
 *   ⑥ 实时预览（按当前配置渲染）
 *   ⑦ 保存：复用好后端模板 CRUD（新建 / 更新）
 *
 * 纯前端组件，零后端改动。
 * ------------------------------------------------------------------ */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Label } from '@client/src/components/ui/label';
import {
  type FieldBlock,
  type HangtagContentConfig,
  type HangtagStyleConfig,
  type HangtagTemplateFull,
  FIELD_CATALOG,
  FIELD_MAP,
  PAPER_PRESETS,
  PAPER_MAP,
  PX_PER_MM,
  resolvePaper,
  createDefaultTemplate,
} from './types';
import { hangtagApi } from '@client/src/api/hangtag';
import HangtagPreview from './HangtagPreview';

export interface HangtagTemplateEditorProps {
  open: boolean;
  onClose: () => void;
  /** 编辑已有模板；为空表示新建 */
  template?: HangtagTemplateFull | null;
  /** 保存成功后回调 */
  onSaved?: (tpl: HangtagTemplateFull) => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const uid = () => Math.random().toString(36).slice(2, 10);

type Interaction =
  | {
      mode: 'move' | 'resize';
      id: string;
      startClientX: number;
      startClientY: number;
      startX: number;
      startY: number;
      startW: number;
      startH: number;
    }
  | null;

const HangtagTemplateEditor: React.FC<HangtagTemplateEditorProps> = ({
  open,
  onClose,
  template,
  onSaved,
}) => {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [content, setContent] = useState<HangtagContentConfig>({ fields: [] });
  const [style, setStyle] = useState<HangtagStyleConfig>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [interaction, setInteraction] = useState<Interaction>(null);
  const [dragOver, setDragOver] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const paperRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewportW, setViewportW] = useState(600);

  const paper = useMemo(() => resolvePaper(style), [style]);
  const W = paper.w * PX_PER_MM;
  const H = paper.h * PX_PER_MM;
  // 适配视口宽度（留出边距），同时允许放大到 1.4 倍便于精细编辑
  const scale = clamp((viewportW - 32) / W, 0.18, 1.4);

  /* 打开 / 切换模板时载入初始值 */
  useEffect(() => {
    if (!open) return;
    if (template) {
      setName(template.name || '');
      setCode(template.code || '');
      setContent({
        title: template.contentConfig?.title ?? '',
        subtitle: template.contentConfig?.subtitle ?? '',
        footer: template.contentConfig?.footer ?? '',
        fields: (template.contentConfig?.fields || []).map((f) => ({ ...f })),
      });
      setStyle({ ...(template.styleConfig || {}) });
    } else {
      const def = createDefaultTemplate();
      setName('');
      setCode('');
      setContent(def.contentConfig);
      setStyle(def.styleConfig);
    }
    setSelectedId(null);
    setInteraction(null);
    setPreviewOpen(false);
  }, [open, template]);

  /* 视口宽度测量（用于自适应缩放） */
  useEffect(() => {
    if (!open || !viewportRef.current) return;
    const el = viewportRef.current;
    const ro = new ResizeObserver(() => setViewportW(el.clientWidth));
    ro.observe(el);
    setViewportW(el.clientWidth);
    return () => ro.disconnect();
  }, [open]);

  /* 拖动 / 缩放：window 级指针监听 */
  useEffect(() => {
    if (!interaction) return;
    const mmpx = PX_PER_MM * scale;
    const onMove = (e: PointerEvent) => {
      const dxMm = (e.clientX - interaction.startClientX) / mmpx;
      const dyMm = (e.clientY - interaction.startClientY) / mmpx;
      setContent((c) => ({
        ...c,
        fields: c.fields.map((f) => {
          if (f.id !== interaction.id) return f;
          if (interaction.mode === 'move') {
            const x = clamp(interaction.startX + dxMm, 0, paper.w - f.w);
            const y = clamp(interaction.startY + dyMm, 0, paper.h - f.h);
            return { ...f, x, y };
          }
          const w = clamp(interaction.startW + dxMm, 8, paper.w - f.x);
          const h = clamp(interaction.startH + dyMm, 6, paper.h - f.y);
          return { ...f, w, h };
        }),
      }));
    };
    const onUp = () => setInteraction(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [interaction, scale, paper.w, paper.h]);

  if (!open) return null;

  /* ---------- 字段操作 ---------- */
  const addField = (key: string, xMm: number, yMm: number) => {
    const cat = FIELD_MAP[key];
    if (!cat) return;
    const w = cat.defaultW;
    const h = cat.defaultH;
    const x = clamp(xMm - w / 2, 0, paper.w - w);
    const y = clamp(yMm - h / 2, 0, paper.h - h);
    const block: FieldBlock = {
      id: `${key}-${uid()}`,
      key,
      label: cat.label,
      type: cat.type,
      x,
      y,
      w,
      h,
      fontSize: style.fontSize ?? 9,
      bold: false,
      align: 'left',
      color: '#111111',
      show: true,
    };
    setContent((c) => ({ ...c, fields: [...c.fields, block] }));
    setSelectedId(block.id);
  };

  const updateSelected = (patch: Partial<FieldBlock>) => {
    if (!selectedId) return;
    setContent((c) => ({
      ...c,
      fields: c.fields.map((f) => (f.id === selectedId ? { ...f, ...patch } : f)),
    }));
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    setContent((c) => ({ ...c, fields: c.fields.filter((f) => f.id !== selectedId) }));
    setSelectedId(null);
  };

  const selected = content.fields.find((f) => f.id === selectedId) || null;

  /* ---------- 纸张操作 ---------- */
  const onPresetChange = (key: string) => {
    if (key === 'CUSTOM') {
      setStyle((s) => ({ ...s, paper: 'CUSTOM' }));
      return;
    }
    const p = PAPER_MAP[key];
    if (!p) return;
    setStyle((s) => ({
      ...s,
      paper: key,
      paperWidthMm: p.w,
      paperHeightMm: p.h,
    }));
  };

  /* ---------- 保存 ---------- */
  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('请填写模板名称');
      return;
    }
    if (!code.trim()) {
      toast.error('请填写模板编码');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        code: code.trim(),
        name: name.trim(),
        contentConfig: content,
        styleConfig: style,
        status: 'active',
      };
      const saved = template?.id
        ? await hangtagApi.updateTemplate(template.id, payload)
        : await hangtagApi.createTemplate(payload);
      toast.success(template?.id ? '模板已更新' : '模板已创建');
      onSaved?.(saved);
      onClose();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  /* ---------- 画布拖放 ---------- */
  const onCanvasDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const key = e.dataTransfer.getData('text/plain');
    if (!key || !FIELD_MAP[key]) return;
    const rect = paperRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mmpx = PX_PER_MM * scale;
    const xMm = (e.clientX - rect.left) / mmpx;
    const yMm = (e.clientY - rect.top) / mmpx;
    addField(key, xMm, yMm);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-3">
      <div className="w-[96vw] h-[92vh] bg-background rounded-lg shadow-xl flex flex-col overflow-hidden">
        {/* 顶栏 */}
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <div className="font-semibold text-base">
            {template ? '编辑吊牌模板' : '新增吊牌模板'}
          </div>
          <div className="flex items-center gap-2 ml-4">
            <Label className="text-xs">编码</Label>
            <Input
              className="w-32 h-8"
              value={code}
              placeholder="如 HT-A6-01"
              onChange={(e) => setCode(e.target.value)}
            />
            <Label className="text-xs">名称</Label>
            <Input
              className="w-48 h-8"
              value={name}
              placeholder="如 标准A6吊牌"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setPreviewOpen(true)}>
              预览
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? '保存中…' : '保存模板'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>
              关闭
            </Button>
          </div>
        </div>

        {/* 主体 */}
        <div className="flex flex-1 min-h-0">
          {/* 左侧：字段调色板 */}
          <div className="w-56 border-r p-3 overflow-auto">
            <div className="text-xs font-medium text-muted-foreground mb-2">字段（拖入或点击添加）</div>
            <div className="space-y-1.5">
              {FIELD_CATALOG.map((f) => (
                <div
                  key={f.key}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData('text/plain', f.key);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => addField(f.key, 12, 12 + content.fields.length * 2)}
                  className="cursor-grab active:cursor-grabbing border rounded-md px-2 py-1.5 text-sm hover:bg-muted flex items-center justify-between"
                  title={`拖入画布或点击添加：${f.label}`}
                >
                  <span>{f.label}</span>
                  <span className="text-[10px] text-muted-foreground uppercase">
                    {f.type === 'text' ? '文本' : f.type === 'barcode' ? '条码' : '二维码'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* 中间：画布 */}
          <div
            ref={viewportRef}
            className="flex-1 overflow-auto bg-muted/40 flex items-start justify-center p-4"
          >
            <div
              ref={paperRef}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onCanvasDrop}
              style={{
                width: W * scale,
                height: H * scale,
                background: paper.bg,
                border: `${dragOver ? 2 : 1}px dashed ${dragOver ? '#2563eb' : '#94a3b8'}`,
                position: 'relative',
                flex: 'none',
                boxShadow: '0 1px 4px rgba(0,0,0,0.12)',
              }}
            >
              {/* 标题 / 副标题 / 页脚 占位 */}
              {content.title && (
                <div
                  style={{
                    position: 'absolute',
                    top: paper.paddingMm * PX_PER_MM * scale,
                    left: 0,
                    right: 0,
                    textAlign: 'center',
                    fontSize: (style.fontSize ?? 9) * 1.4 * scale,
                    fontWeight: 700,
                    color: '#111',
                    pointerEvents: 'none',
                  }}
                >
                  {content.title}
                </div>
              )}
              {content.subtitle && (
                <div
                  style={{
                    position: 'absolute',
                    top: (paper.paddingMm + (style.fontSize ?? 9) * 1.6) * PX_PER_MM * scale,
                    left: 0,
                    right: 0,
                    textAlign: 'center',
                    fontSize: (style.fontSize ?? 9) * scale,
                    color: '#555',
                    pointerEvents: 'none',
                  }}
                >
                  {content.subtitle}
                </div>
              )}

              {/* 字段块 */}
              {content.fields.map((f) => {
                const isSel = f.id === selectedId;
                return (
                  <div
                    key={f.id}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setSelectedId(f.id);
                      setInteraction({
                        mode: 'move',
                        id: f.id,
                        startClientX: e.clientX,
                        startClientY: e.clientY,
                        startX: f.x,
                        startY: f.y,
                        startW: f.w,
                        startH: f.h,
                      });
                    }}
                    style={{
                      position: 'absolute',
                      left: f.x * PX_PER_MM * scale,
                      top: f.y * PX_PER_MM * scale,
                      width: f.w * PX_PER_MM * scale,
                      height: f.h * PX_PER_MM * scale,
                      border: isSel ? '2px solid #2563eb' : '1px solid rgba(37,99,235,0.4)',
                      background: 'rgba(37,99,235,0.06)',
                      borderRadius: 2,
                      boxSizing: 'border-box',
                      cursor: 'move',
                      fontSize: (f.fontSize ?? style.fontSize ?? 9) * scale,
                      color: f.color ?? '#111',
                      fontWeight: f.bold ? 700 : 400,
                      display: 'flex',
                      alignItems: 'center',
                      padding: 1,
                      overflow: 'hidden',
                    }}
                    title={`${f.label}（${f.type}）`}
                  >
                    <span style={{ letterSpacing: 0.2 }}>
                      {f.label}
                      {f.type !== 'text' ? ` [${f.type === 'barcode' ? '条码' : '二维码'}]` : ''}
                    </span>
                    {isSel && (
                      <div
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          setInteraction({
                            mode: 'resize',
                            id: f.id,
                            startClientX: e.clientX,
                            startClientY: e.clientY,
                            startX: f.x,
                            startY: f.y,
                            startW: f.w,
                            startH: f.h,
                          });
                        }}
                        style={{
                          position: 'absolute',
                          right: -4,
                          bottom: -4,
                          width: 12,
                          height: 12,
                          background: '#2563eb',
                          borderRadius: 2,
                          cursor: 'nwse-resize',
                        }}
                        title="拖动缩放"
                      />
                    )}
                  </div>
                );
              })}

              {content.fields.length === 0 && (
                <div
                  className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground pointer-events-none"
                  style={{ padding: paper.paddingMm * PX_PER_MM * scale }}
                >
                  从左侧拖拽字段到此处开始设计
                </div>
              )}
            </div>
          </div>

          {/* 右侧：属性 + 纸张 */}
          <div className="w-72 border-l p-3 overflow-auto space-y-4">
            {/* 纸张设置 */}
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-2">纸张设置</div>
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label className="text-xs">纸张规格</Label>
                  <select
                    className="w-full border rounded-md h-8 px-2 text-sm bg-background"
                    value={style.paper ?? 'A6'}
                    onChange={(e) => onPresetChange(e.target.value)}
                  >
                    {PAPER_PRESETS.map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">宽(mm)</Label>
                    <Input
                      type="number"
                      className="h-8"
                      value={paper.w}
                      onChange={(e) =>
                        setStyle((s) => ({
                          ...s,
                          paper: 'CUSTOM',
                          paperWidthMm: Number(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">高(mm)</Label>
                    <Input
                      type="number"
                      className="h-8"
                      value={paper.h}
                      onChange={(e) =>
                        setStyle((s) => ({
                          ...s,
                          paper: 'CUSTOM',
                          paperHeightMm: Number(e.target.value) || 0,
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">方向</Label>
                  <select
                    className="w-full border rounded-md h-8 px-2 text-sm bg-background"
                    value={style.orientation ?? 'portrait'}
                    onChange={(e) =>
                      setStyle((s) => ({
                        ...s,
                        orientation: e.target.value as 'portrait' | 'landscape',
                      }))
                    }
                  >
                    <option value="portrait">纵向</option>
                    <option value="landscape">横向</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">内边距(mm)</Label>
                    <Input
                      type="number"
                      className="h-8"
                      value={style.paddingMm ?? 4}
                      onChange={(e) =>
                        setStyle((s) => ({ ...s, paddingMm: Number(e.target.value) || 0 }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">基础字号</Label>
                    <Input
                      type="number"
                      className="h-8"
                      value={style.fontSize ?? 9}
                      onChange={(e) =>
                        setStyle((s) => ({ ...s, fontSize: Number(e.target.value) || 9 }))
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">背景色</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      className="h-8 w-10 border rounded"
                      value={style.bg ?? '#ffffff'}
                      onChange={(e) => setStyle((s) => ({ ...s, bg: e.target.value }))}
                    />
                    <Input
                      className="h-8 flex-1"
                      value={style.bg ?? '#ffffff'}
                      onChange={(e) => setStyle((s) => ({ ...s, bg: e.target.value }))}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 标题文本 */}
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-2">标题文本</div>
              <div className="space-y-2">
                <Input
                  className="h-8"
                  placeholder="标题"
                  value={content.title ?? ''}
                  onChange={(e) => setContent((c) => ({ ...c, title: e.target.value }))}
                />
                <Input
                  className="h-8"
                  placeholder="副标题"
                  value={content.subtitle ?? ''}
                  onChange={(e) => setContent((c) => ({ ...c, subtitle: e.target.value }))}
                />
                <Input
                  className="h-8"
                  placeholder="页脚"
                  value={content.footer ?? ''}
                  onChange={(e) => setContent((c) => ({ ...c, footer: e.target.value }))}
                />
              </div>
            </div>

            {/* 选中字段属性 */}
            <div>
              <div className="text-xs font-medium text-muted-foreground mb-2">
                字段属性
              </div>
              {!selected ? (
                <div className="text-xs text-muted-foreground">
                  在画布中点选一个字段以编辑其格式
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label className="text-xs">标签</Label>
                    <Input
                      className="h-8"
                      value={selected.label}
                      onChange={(e) => updateSelected({ label: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">类型（{selected.type}）</Label>
                    <div className="text-xs text-muted-foreground">
                      由字段决定，不可更改
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">字号</Label>
                      <Input
                        type="number"
                        className="h-8"
                        value={selected.fontSize ?? style.fontSize ?? 9}
                        onChange={(e) =>
                          updateSelected({ fontSize: Number(e.target.value) || 9 })
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">对齐</Label>
                      <select
                        className="w-full border rounded-md h-8 px-2 text-sm bg-background"
                        value={selected.align ?? 'left'}
                        onChange={(e) =>
                          updateSelected({
                            align: e.target.value as 'left' | 'center' | 'right',
                          })
                        }
                      >
                        <option value="left">左</option>
                        <option value="center">中</option>
                        <option value="right">右</option>
                      </select>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">文字颜色</Label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        className="h-8 w-10 border rounded"
                        value={selected.color ?? '#111111'}
                        onChange={(e) => updateSelected({ color: e.target.value })}
                      />
                      <Input
                        className="h-8 flex-1"
                        value={selected.color ?? '#111111'}
                        onChange={(e) => updateSelected({ color: e.target.value })}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">前缀</Label>
                      <Input
                        className="h-8"
                        value={selected.prefix ?? ''}
                        onChange={(e) => updateSelected({ prefix: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">后缀</Label>
                      <Input
                        className="h-8"
                        value={selected.suffix ?? ''}
                        onChange={(e) => updateSelected({ suffix: e.target.value })}
                      />
                    </div>
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={!!selected.bold}
                      onChange={(e) => updateSelected({ bold: e.target.checked })}
                    />
                    加粗
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={selected.show !== false}
                      onChange={(e) => updateSelected({ show: e.target.checked })}
                    />
                    参与打印（取消则仅预览可见）
                  </label>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full"
                    onClick={deleteSelected}
                  >
                    删除该字段
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 预览弹层 */}
      {previewOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="bg-white rounded-lg p-4 max-w-[90vw] max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium">打印预览（1:1 实际尺寸）</div>
              <Button variant="ghost" size="sm" onClick={() => setPreviewOpen(false)}>
                关闭
              </Button>
            </div>
            <HangtagPreview content={content} style={style} />
          </div>
        </div>
      )}
    </div>
  );
};

export default HangtagTemplateEditor;
