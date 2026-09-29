import React from 'react';
import { UniqueCodeTrace } from '@client/src/components/UniqueCodeTrace';

/**
 * 唯一码溯源页：单码历史出入库查询 + 防串货调查入口。
 * 子组件 UniqueCodeTrace 负责检索框、状态卡、时间线与 CSV 导出。
 */
const UniqueCodeTracePage: React.FC = () => {
  return (
    <div style={{ padding: 16, maxWidth: 880, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 4px' }}>唯一码溯源</h2>
      <p style={{ color: '#666', marginTop: 0, fontSize: 13 }}>
        输入任意唯一码，回溯其完整历史出入库流水（采购入库 → 销售/零售出库 → 结算核销 → 退货回库），
        快速定位串货、错发与异常件。
      </p>
      <UniqueCodeTrace />
    </div>
  );
};

export default UniqueCodeTracePage;
