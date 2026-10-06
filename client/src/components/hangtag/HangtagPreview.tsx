/* ------------------------------------------------------------------ *
 * 吊牌预览（只读渲染）
 *
 * 按 `纸张 + 内容配置 + 样式配置` 绝对定位渲染一张吊牌。
 * 供两处复用：① 模板设计器的"预览"面板；② 打印页的"打印预览"。
 *
 * 渲染规则：
 *   - 纸张尺寸由 resolvePaper() 得出（mm → px，1mm = PX_PER_MM px）。
 *   - 支持 scale（整体缩放）或 maxWidth（自适应宽度）。
 *   - text 字段渲染 前缀+值+后缀；barcode 渲染条形码占位；qrcode 渲染二维码占位。
 * ------------------------------------------------------------------ */
import React from 'react';
import {
  type FieldBlock,
  type HangtagContentConfig,
  type HangtagStyleConfig,
  PX_PER_MM,
  resolvePaper,
  SAMPLE_DATA,
} from './types';

export interface HangtagPreviewProps {
  content: HangtagContentConfig;
  style?: HangtagStyleConfig;
  /** 字段取值；缺省用 SAMPLE_DATA 演示 */
  data?: Record<string, string>;
  /** 固定缩放（1 = 实际尺寸）。若给定 maxWidth 则以 maxWidth 优先 */
  scale?: number;
  /** 若给定，自动计算 scale 使纸张宽度不超过该像素值 */
  maxWidth?: number;
  /** 是否显示纸张边框（默认 true） */
  showChrome?: boolean;
}

/** 伪条形码：由字符串确定性生成疏密相间的竖条 */
const BarcodeBars: React.FC<{ code: string; color: string }> = ({ code, color }) => {
  const bars: number[] = [];
  let seed = 0;
  for (let i = 0; i < code.length; i++) seed = (seed * 31 + code.charCodeAt(i)) >>> 0;
  for (let i = 0; i < 48; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    bars.push(1 + (seed % 3));
  }
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height: '100%', width: '100%', gap: 1 }}>
      {bars.map((bw, i) => (
        <div key={i} style={{ width: bw, background: i % 2 ? 'transparent' : color }} />
      ))}
    </div>
  );
};

/** 伪二维码：确定性点阵 + 三个定位角 */
const QrPlaceholder: React.FC<{ color: string }> = ({ color }) => {
  const n = 13;
  let seed = 0x2545f4;
  const cells: number[] = [];
  for (let i = 0; i < n * n; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    cells.push((seed >> 4) & 1);
  }
  const isFinder = (r: number, c: number): boolean => {
    const inBox = (br: number, bc: number) =>
      r >= br && r < br + 4 && c >= bc && c < bc + 4;
    return inBox(0, 0) || inBox(0, n - 4) || inBox(n - 4, 0);
  };
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${n},1fr)`,
        gridTemplateRows: `repeat(${n},1fr)`,
        width: '100%',
        height: '100%',
        background: '#fff',
        padding: 2,
        boxSizing: 'border-box',
      }}
    >
      {Array.from({ length: n * n }).map((_, i) => {
        const r = Math.floor(i / n);
        const c = i % n;
        let on = cells[i] === 1;
        if (isFinder(r, c)) {
          const lr = r < 4 ? r : r - (n - 4);
          const lc = c < 4 ? c : c - (n - 4);
          const edge = lr === 0 || lr === 3 || lc === 0 || lc === 3;
          const core = lr >= 1 && lr <= 2 && lc >= 1 && lc <= 2;
          on = edge || core;
        }
        return <div key={i} style={{ background: on ? color : '#fff' }} />;
      })}
    </div>
  );
};

const HangtagPreview: React.FC<HangtagPreviewProps> = ({
  content,
  style,
  data,
  scale,
  maxWidth,
  showChrome = true,
}) => {
  const paper = resolvePaper(style);
  const dataset = data ?? SAMPLE_DATA;
  const W = paper.w * PX_PER_MM;
  const H = paper.h * PX_PER_MM;
  const finalScale =
    maxWidth && maxWidth > 0 ? Math.min(scale ?? 1, maxWidth / W) : scale ?? 1;

  const baseFont = style?.fontSize ?? 9;

  const renderField = (f: FieldBlock) => {
    if (f.show === false) return null;
    const fs = f.fontSize ?? baseFont;
    const value = dataset[f.key] ?? '';
    const text = `${f.prefix ?? ''}${value}${f.suffix ?? ''}`;
    const common: React.CSSProperties = {
      position: 'absolute',
      left: f.x * PX_PER_MM,
      top: f.y * PX_PER_MM,
      width: f.w * PX_PER_MM,
      height: f.h * PX_PER_MM,
      fontSize: fs,
      fontWeight: f.bold ? 700 : 400,
      textAlign: f.align ?? 'left',
      color: f.color ?? '#111',
      boxSizing: 'border-box',
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
    };

    if (f.type === 'barcode') {
      return (
        <div key={f.id} style={common} title={`${f.label}：${value}`}>
          <div style={{ width: '100%' }}>
            <div style={{ height: '70%' }}>
              <BarcodeBars code={value || f.key} color={f.color ?? '#111'} />
            </div>
            <div style={{ fontSize: fs * 0.85, textAlign: 'center', marginTop: 1 }}>
              {value || f.key}
            </div>
          </div>
        </div>
      );
    }

    if (f.type === 'qrcode') {
      return (
        <div
          key={f.id}
          style={{
            ...common,
            padding: 1,
            flexDirection: 'column',
            background: '#fff',
            border: '1px solid #ddd',
          }}
          title={`${f.label}（打印时生成真实溯源二维码）`}
        >
          <div style={{ flex: 1, width: '100%' }}>
            <QrPlaceholder color={f.color ?? '#111'} />
          </div>
          <div style={{ fontSize: fs * 0.85, textAlign: 'center', lineHeight: 1 }}>
            {f.label}
          </div>
        </div>
      );
    }

    return (
      <div key={f.id} style={common} title={`${f.label}：${text}`}>
        {text}
      </div>
    );
  };

  return (
    <div
      style={{
        width: W * finalScale,
        height: H * finalScale,
        position: 'relative',
      }}
    >
      <div
        style={{
          width: W,
          height: H,
          position: 'absolute',
          top: 0,
          left: 0,
          transform: `scale(${finalScale})`,
          transformOrigin: 'top left',
          background: paper.bg,
          border: showChrome ? '1px solid #cbd5e1' : 'none',
          boxSizing: 'border-box',
          overflow: 'hidden',
          color: '#111',
        }}
      >
        {/* 标题 / 副标题（顶部居中） */}
        {content.title && (
          <div
            style={{
              position: 'absolute',
              top: paper.paddingMm * PX_PER_MM,
              left: paper.paddingMm * PX_PER_MM,
              right: paper.paddingMm * PX_PER_MM,
              textAlign: 'center',
              fontSize: baseFont * 1.4,
              fontWeight: 700,
            }}
          >
            {content.title}
          </div>
        )}
        {content.subtitle && (
          <div
            style={{
              position: 'absolute',
              top: (paper.paddingMm + baseFont * 1.6) * PX_PER_MM,
              left: paper.paddingMm * PX_PER_MM,
              right: paper.paddingMm * PX_PER_MM,
              textAlign: 'center',
              fontSize: baseFont,
              color: '#555',
            }}
          >
            {content.subtitle}
          </div>
        )}

        {/* 字段块 */}
        {content.fields.map(renderField)}

        {/* 页脚（底部居中） */}
        {content.footer && (
          <div
            style={{
              position: 'absolute',
              bottom: paper.paddingMm * PX_PER_MM,
              left: paper.paddingMm * PX_PER_MM,
              right: paper.paddingMm * PX_PER_MM,
              textAlign: 'center',
              fontSize: baseFont * 0.9,
              color: '#666',
            }}
          >
            {content.footer}
          </div>
        )}
      </div>
    </div>
  );
};

export default HangtagPreview;
