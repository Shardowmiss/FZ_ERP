import type { Sku } from '@shared/api.interface';
import type { StyleBlockData, StyleMatrix } from './StyleMatrixBlock';

export function buildMatrixFromSkus(skuList: Sku[], defaultPriceField: keyof Sku = 'supplyPrice'): StyleMatrix {
  const matrix: StyleMatrix = {};
  for (const sku of skuList) {
    if (!matrix[sku.color]) matrix[sku.color] = {};
    const price = Number(sku[defaultPriceField]) || 0;
    matrix[sku.color][sku.size] = { qty: 0, price };
  }
  return matrix;
}

export function buildStyleBlock(
  styleId: string,
  styleNo: string,
  styleName: string,
  skuList: Sku[],
  defaultPriceField: keyof Sku = 'supplyPrice',
  brand?: string,
): StyleBlockData {
  return {
    styleId,
    styleNo,
    styleName,
    brand,
    skuList,
    matrix: buildMatrixFromSkus(skuList, defaultPriceField),
    collapsed: false,
  };
}

export interface FlatSkuItem {
  styleId: string;
  styleNo: string;
  skuId: string;
  skuCode: string;
  color: string;
  size: string;
  quantity: number;
  price: number;
  amount: number;
  [key: string]: unknown;
}

export function flattenToSkus(blocks: StyleBlockData[]): FlatSkuItem[] {
  const result: FlatSkuItem[] = [];
  for (const block of blocks) {
    for (const sku of block.skuList) {
      const cell = block.matrix[sku.color]?.[sku.size];
      const qty = cell?.qty || 0;
      const price = cell?.price || 0;
      if (qty > 0) {
        result.push({
          styleId: block.styleId,
          styleNo: block.styleNo,
          skuId: sku.id,
          skuCode: sku.skuCode,
          color: sku.color,
          size: sku.size,
          quantity: qty,
          price,
          amount: Number((qty * price).toFixed(2)),
        });
      }
    }
  }
  return result;
}

export async function buildBlocksFromItems<T extends {
  styleId?: string;
  styleNo: string;
  skuId: string;
  color?: string;
  size?: string;
  quantity: number;
  price: number;
}>(
  items: T[],
  fetchSkuByStyle: (styleId: string) => Promise<Sku[]>,
  styleIdResolver?: (item: T, index: number) => string,
): Promise<StyleBlockData[]> {
  const styleMap = new Map<string, { styleId: string; styleNo: string; styleName: string; items: T[] }>();
  items.forEach((item, index) => {
    const styleId = styleIdResolver ? styleIdResolver(item, index) : (item.styleId || '');
    if (!styleId) return;
    if (!styleMap.has(styleId)) {
      styleMap.set(styleId, { styleId, styleNo: item.styleNo, styleName: '', items: [] });
    }
    styleMap.get(styleId)!.items.push(item);
  });

  const blocks: StyleBlockData[] = [];
  for (const [styleId, info] of styleMap.entries()) {
    try {
      const skus = await fetchSkuByStyle(styleId);
      const matrix: StyleMatrix = {};
      for (const sku of skus) {
        if (!matrix[sku.color]) matrix[sku.color] = {};
        const existing = info.items.find(
          (it: T) => it.skuId === sku.id || (it.color === sku.color && it.size === sku.size),
        );
        matrix[sku.color][sku.size] = {
          qty: existing?.quantity || 0,
          price: existing?.price || sku.supplyPrice || 0,
        };
      }
      blocks.push({
        styleId,
        styleNo: info.styleNo,
        styleName: info.styleName,
        skuList: skus,
        matrix,
        collapsed: false,
      });
    } catch {
      // skip
    }
  }
  return blocks;
}

export function calcBlocksTotal(blocks: StyleBlockData[]): { totalQty: number; totalAmount: number } {
  let totalQty = 0;
  let totalAmount = 0;
  for (const block of blocks) {
    for (const color of Object.keys(block.matrix)) {
      for (const size of Object.keys(block.matrix[color])) {
        const cell = block.matrix[color][size];
        const qty = cell?.qty || 0;
        const price = cell?.price || 0;
        totalQty += qty;
        totalAmount += qty * price;
      }
    }
  }
  return { totalQty, totalAmount };
}
