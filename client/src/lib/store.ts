/**
 * 门店常量（单一来源，收口原先散落在各页面的硬编码门店ID/名称）
 *
 * 说明：连锁门店的 POS 客户端通常绑定到单一门店，门店信息在此集中定义。
 * 若未来需要从登录态/配置中心动态获取门店，只需在此处替换实现，
 * 所有引用方（页面、api 层、OfflineProvider）无需改动。
 */
export const STORE_ID = 'HZ-HB-YT-001';
export const STORE_NAME = '杭州湖滨银泰旗舰店';
