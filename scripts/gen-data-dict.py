#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ERP 数据字典生成器
====================
单一事实源：仓库根目录 `data-dictionary.json`（人维护的中文映射）。
权威结构来源：live erp_db 的 pg_catalog 自省（表/字段/类型/可空/默认值/主键/已有注释）。

工作流：
  1) 自省 live DB，得到权威表结构；
  2) 与 data-dictionary.json 合并（已确认项优先，缺失项用领域启发式中文化并标记为「推断」）；
  3) 写回 data-dictionary.json（便于后续人工校正）；
  4) 生成 docs/数据字典.xlsx（多 Sheet：说明 / 字段字典 / 表清单 / 待补充）；
  5) 生成 scripts/data-dict.comments.sql（COMMENT ON 语句，把中文写进数据库结构）；
  6) --apply 时把 COMMENT ON 真正写入 live erp_db（仅注释，幂等、安全）。

约定（见 docs/数据字典维护约定.md）：
  任何表结构变更后，更新 data-dictionary.json 中对应中文，再重跑本脚本，
  Excel 与 DB 注释会随之迭代；「待补充」Sheet 列出仍为「推断」的字段，供人工校正。
"""
import os
import sys
import json
import subprocess
import datetime
import argparse

# ----------------------------------------------------------------------------
# 路径
# ----------------------------------------------------------------------------
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DICT_PATH = os.path.join(ROOT, "data-dictionary.json")
XLSX_PATH = os.path.join(ROOT, "docs", "数据字典.xlsx")
SQL_PATH = os.path.join(ROOT, "scripts", "data-dict.comments.sql")

PSQL = os.environ.get("PSQL_BIN", "/opt/homebrew/bin/psql")
PG = dict(
    host=os.environ.get("PGHOST", "localhost"),
    port=os.environ.get("PGPORT", "5434"),
    user=os.environ.get("PGUSER", "erp"),
    dbname=os.environ.get("PGDATABASE", "erp_db"),
    password=os.environ.get("PGPASSWORD", "erp"),
)

# ----------------------------------------------------------------------------
# 领域词表（启发式中文）—— 覆盖常见 ERP 字段命名
# ----------------------------------------------------------------------------
KNOWN = {
    "id": "ID", "pk": "主键", "uuid": "UUID",
    "no": "编号", "code": "编码", "sn": "流水号", "barcode": "条码", "qr": "二维码",
    "name": "名称", "title": "标题", "alias": "别名", "nickname": "昵称",
    "type": "类型", "kind": "种类", "class": "分类", "category": "分类",
    "status": "状态", "state": "状态", "flag": "标志",
    "mode": "模式", "method": "方式", "way": "方式",
    "remark": "备注", "note": "备注", "memo": "备注", "desc": "描述",
    "description": "描述", "comment": "备注", "content": "内容", "text": "文本",
    "qty": "数量", "quantity": "数量", "count": "数量", "num": "数量", "number": "数量",
    "amount": "金额", "amt": "金额", "money": "金额", "total": "合计", "sum": "合计",
    "price": "单价", "cost": "成本", "fee": "费用", "charge": "费用",
    "rate": "比率", "ratio": "比率", "percent": "百分比", "discount": "折扣",
    "tax": "税额", "currency": "币种", "exchange": "兑换",
    "date": "日期", "time": "时间", "day": "日", "datetime": "时间", "timestamp": "时间戳",
    "month": "月份", "year": "年份", "week": "周", "hour": "小时", "minute": "分钟",
    "phone": "电话", "mobile": "手机", "tel": "电话", "email": "邮箱", "fax": "传真",
    "address": "地址", "province": "省份", "city": "城市", "district": "区县",
    "region": "区域", "area": "区域", "country": "国家", "zone": "地区",
    "gender": "性别", "sex": "性别", "age": "年龄", "birthday": "生日", "birth": "出生日期",
    "avatar": "头像", "photo": "照片", "image": "图片", "video": "视频", "file": "文件",
    "attach": "附件", "attachment": "附件", "url": "链接", "link": "链接", "path": "路径",
    "sort": "排序", "seq": "序号", "sequence": "序号", "order": "排序序号", "rank": "排名",
    "version": "版本", "revision": "修订",
    "enabled": "是否启用", "active": "是否启用", "locked": "是否锁定", "deleted": "是否删除",
    "hidden": "是否隐藏", "visible": "是否可见", "published": "是否发布", "draft": "是否草稿",
    "spec": "规格", "model": "型号", "size": "尺寸", "color": "颜色", "colour": "颜色",
    "weight": "重量", "volume": "体积", "length": "长度", "width": "宽度", "height": "高度",
    "dimension": "维度", "unit": "单位", "capacity": "容量",
    # 业务实体
    "user": "用户", "member": "会员", "customer": "客户", "vip": "会员", "guest": "访客",
    "staff": "员工", "employee": "员工", "role": "角色", "org": "组织", "organization": "组织",
    "department": "部门", "dept": "部门", "company": "公司", "tenant": "租户",
    "store": "门店", "shop": "店铺", "outlet": "门店", "pos": "POS终端", "terminal": "终端",
    "device": "设备", "machine": "设备", "warehouse": "仓库", "depot": "仓库",
    "location": "库位", "shelf": "货架", "stock": "库存", "inventory": "库存",
    "product": "商品", "goods": "商品", "sku": "商品(SKU)", "spu": "商品(SPU)",
    "brand": "品牌", "supplier": "供应商", "vendor": "供应商", "manufacturer": "制造商",
    "factory": "工厂", "partner": "合作伙伴", "dealer": "经销商", "agent": "代理商",
    "channel": "渠道", "gpo": "集采(GPO)", "erp": "ERP", "crm": "CRM", "api": "接口",
    # 单据 / 流程
    "order": "订单", "sale": "销售", "sales": "销售", "purchase": "采购",
    "procurement": "采购", "buy": "采购", "so": "销售订单", "po": "采购订单",
    "cart": "购物车", "retail": "零售", "wholesale": "批发", "return": "退货",
    "refund": "退款", "exchange": "换货", "ship": "发货", "shipping": "发货",
    "delivery": "配送", "express": "快递", "receive": "收货", "receipt": "收货小票",
    "bill": "单据", "doc": "单据", "document": "单据", "invoice": "发票",
    "account": "账户", "bank": "银行", "card": "卡", "wallet": "钱包", "balance": "余额",
    "point": "积分", "score": "积分", "coupon": "优惠券", "voucher": "代金券",
    "promotion": "促销", "campaign": "活动", "activity": "活动", "rebate": "返利",
    "payment": "支付", "pay": "支付", "settle": "结算", "settlement": "结算",
    "transaction": "交易", "flow": "流水", "ledger": "台账", "profit": "利润",
    "loss": "亏损", "revenue": "收入", "expense": "支出", "income": "收入", "margin": "毛利",
    # 主数据 / 配置
    "config": "配置", "setting": "设置", "settings": "设置", "param": "参数",
    "parameter": "参数", "option": "选项", "template": "模板", "rule": "规则",
    "policy": "策略", "polic": "策略", "strategy": "策略", "plan": "计划",
    "task": "任务", "job": "任务", "schedule": "调度", "cron": "定时", "trigger": "触发器",
    "event": "事件", "hook": "钩子", "callback": "回调", "queue": "队列", "batch": "批次",
    "lot": "批次", "master": "主数据", "base": "基础", "common": "通用", "standard": "标准",
    "dict": "字典", "dictionary": "字典",
    # 授权 / 审计
    "rbac": "权限", "permission": "权限", "auth": "认证", "authorize": "授权",
    "login": "登录", "logout": "登出", "register": "注册", "token": "令牌",
    "session": "会话", "openid": "OpenID", "unionid": "UnionID", "password": "密码",
    "menu": "菜单", "log": "日志", "logger": "日志", "audit": "审计", "operation": "操作",
    "error": "错误", "warn": "警告", "warning": "警告", "info": "信息", "debug": "调试",
    "trace": "追踪", "message": "消息", "notify": "通知", "notification": "通知",
    "sms": "短信", "email": "邮件", "push": "推送", "sync": "同步", "import": "导入",
    "export": "导出", "upload": "上传", "download": "下载", "backup": "备份",
    "restore": "恢复", "migrate": "迁移", "seed": "种子",
    # 分析 / 报表
    "report": "报表", "dashboard": "看板", "analytics": "分析", "stat": "统计",
    "statistics": "统计", "metric": "指标", "chart": "图表", "graph": "图表",
    "view": "视图", "query": "查询", "filter": "筛选", "search": "搜索", "page": "分页",
    "limit": "限制", "offset": "偏移", "consistency": "一致性", "check": "校验",
    "validate": "校验", "verify": "验证",
    # 关系 / 结构
    "parent": "上级", "child": "子级", "children": "子级", "root": "根", "tree": "树",
    "node": "节点", "leaf": "叶子", "relation": "关系", "related": "关联",
    "ref": "引用", "source": "来源", "target": "目标", "foreign": "外键", "index": "索引",
    "constraint": "约束", "unique": "唯一", "default": "默认", "ext": "扩展", "extra": "扩展",
    "raw": "原始", "meta": "元信息", "detail": "明细", "item": "明细", "line": "明细行",
    "header": "表头", "body": "表体", "attribute": "属性", "prop": "属性", "property": "属性",
    "feature": "特性", "value": "值", "key": "键", "field": "字段", "column": "列",
    "row": "行", "table": "表", "schema": "模式", "database": "数据库", "db": "数据库",
    "app": "应用", "system": "系统", "platform": "平台", "module": "模块", "service": "服务",
    "tag": "标签", "label": "标签", "grade": "等级", "level": "级别", "star": "星级",
    "rating": "评级", "review": "评价", "feedback": "反馈",
    # 时间相关
    "created": "创建", "updated": "更新", "modified": "修改", "begin": "开始",
    "start": "开始", "end": "结束", "finish": "完成", "expired": "过期", "valid": "有效",
    "effective": "生效", "from": "起始", "to": "至", "between": "区间", "range": "范围",
    "min": "最小", "max": "最大", "avg": "平均", "mean": "平均",
    # 状态词
    "pending": "待处理", "running": "运行中", "waiting": "等待中", "queued": "排队中",
    "processing": "处理中", "finished": "已完成", "completed": "已完成",
    "cancelled": "已取消", "canceled": "已取消", "rejected": "已拒绝", "approved": "已批准",
    "draft": "草稿", "published": "已发布", "archived": "已归档", "closed": "已关闭",
    "close": "关闭", "open": "开启", "on": "开", "off": "关", "current": "当前",
    "old": "旧", "new": "新", "temp": "临时", "tmp": "临时", "history": "历史",
    "snapshot": "快照", "copy": "副本", "clone": "克隆", "mirror": "镜像",
    "async": "异步", "background": "后台", "foreground": "前台", "bulk": "批量",
    "single": "单", "multi": "多", "all": "全部", "part": "部分", "none": "无",
    "threshold": "阈值", "safe": "安全", "reserved": "预留", "allocated": "已分配",
    "frozen": "冻结", "inbound": "入库", "outbound": "出库", "onhand": "在手",
    "available": "可用", "demand": "需求", "supply": "供应", "inspect": "质检",
    "quality": "质量", "defect": "缺陷", "scrap": "报废", "damage": "损坏",
    "wechat": "微信", "alipay": "支付宝", "unionpay": "银联",
}

# 后缀映射
SUFFIX_CN = {
    "_id": "ID", "_no": "编号", "_code": "编码", "_name": "名称", "_type": "类型",
    "_status": "状态", "_state": "状态", "_kind": "种类", "_flag": "标志",
    "_remark": "备注", "_note": "备注", "_memo": "备注", "_desc": "描述",
    "_description": "描述", "_comment": "备注", "_content": "内容",
    "_qty": "数量", "_quantity": "数量", "_count": "数量", "_num": "数量",
    "_amount": "金额", "_amt": "金额", "_money": "金额", "_total": "合计",
    "_price": "单价", "_cost": "成本", "_fee": "费用", "_rate": "比率",
    "_percent": "百分比", "_discount": "折扣", "_tax": "税额",
    "_phone": "电话", "_mobile": "手机", "_tel": "电话", "_email": "邮箱",
    "_date": "日期", "_time": "时间", "_day": "日", "_datetime": "时间",
    "_timestamp": "时间戳", "_month": "月份", "_year": "年份",
    "_sn": "流水号", "_barcode": "条码", "_url": "链接", "_link": "链接",
    "_path": "路径", "_image": "图片", "_photo": "照片", "_file": "文件",
    "_sort": "排序", "_seq": "序号", "_order": "排序序号", "_version": "版本",
    "_unit": "单位", "_spec": "规格", "_model": "型号", "_size": "尺寸",
    "_color": "颜色", "_weight": "重量", "_volume": "体积",
}

BOOL_PREFIX = ("is_", "has_", "can_", "enable", "disable", "allow", "need", "must")


# 额外词表补充（提升覆盖率）
KNOWN.update({
    "transit": "在途", "style": "款式", "available": "可用", "onhand": "在手", "on_hand": "在手",
    "unit_price": "单价", "sale_price": "售价", "cost_price": "成本价", "list_price": "标价",
    "market_price": "市场价", "retail_price": "零售价", "wholesale_price": "批发价",
    "purchase_price": "采购价", "original_price": "原价", "discount_price": "折扣价",
    "member_price": "会员价", "settlement_price": "结算价", "standard_price": "标准价",
    "plan_price": "计划价", "supply_price": "供货价", "tag_price": "吊牌价",
    "domain": "业务域", "mismatch": "不匹配", "run": "运行", "hash": "哈希",
    "allocation": "调拨", "transfer": "调拨", "replenish": "补货", "replenishment": "补货",
    "forecast": "预测", "list": "清单", "spent": "消费", "price": "价格", "snapshot": "快照",
})
# 审计/时间-人 复合模式
AUDIT_AT = {
    "created": "创建时间", "create": "创建时间", "updated": "更新时间", "update": "更新时间",
    "deleted": "删除时间", "modify": "修改时间", "modified": "修改时间",
    "begin": "开始时间", "start": "开始时间", "end": "结束时间", "finish": "完成时间",
    "approved": "审批时间", "submitted": "提交时间", "paid": "支付时间", "ship": "发货时间",
    "receive": "收货时间", "expire": "过期时间", "valid": "生效时间", "publish": "发布时间",
    "login": "登录时间", "logout": "登出时间", "sync": "同步时间", "last": "最后时间",
    "planned": "计划时间", "actual": "实际时间", "estimated": "预计时间", "confirm": "确认时间",
    "cancel": "取消时间", "reject": "拒绝时间", "close": "关闭时间", "open": "开启时间",
}
AUDIT_BY = {
    "created": "创建人", "create": "创建人", "updated": "更新人", "update": "更新人",
    "deleted": "删除人", "modify": "修改人", "modified": "修改人", "submit": "提交人",
    "approve": "审批人", "audit": "审核人", "operator": "操作人", "last": "最后操作人",
    "owner": "负责人", "review": "复核人", "check": "核验人", "confirm": "确认人",
    "cancel": "取消人", "reject": "拒绝人", "close": "关闭人", "open": "开启人",
}

# 领域词补充（补齐主 KNOWN 遗漏的常见字段命名）
KNOWN.update({
    "operator": "操作人", "contact": "联系人", "person": "人", "contact_person": "联系人",
    "username": "用户名", "handler": "经办人", "buyer": "采购员", "seller": "卖方",
    "receiver": "接收人", "hex": "十六进制", "ip": "IP地址", "payload": "负载",
    "result": "结果", "action": "操作", "summary": "摘要", "reason": "原因",
    "priority": "优先级", "segment": "段", "segments": "段", "sample": "样本",
    "samples": "样本", "usage": "用量", "per": "每", "piece": "件",
    "usage_per_piece": "单件用量", "moq": "最小起订量", "direction": "方向",
    "difference": "差额", "season": "季节", "wave": "波次", "fit": "版型",
    "credit_period": "信用账期", "trade_show": "展会", "billing": "账单",
    "billing_address": "账单地址", "shipping_address": "收货地址",
    "bom": "物料清单", "garment": "成衣", "production": "生产",
    "snapshot": "快照", "session": "会话", "cache": "缓存", "domain": "业务域",
})

# 常见词缀补充（进一步降低未译英文碎片）
KNOWN.update({
    "material": "物料", "trade": "贸易", "show": "展会", "pre": "预",
    "used": "已用", "dependent": "依赖", "writeoff": "核销", "receivable": "应收",
    "payable": "应付", "received": "已收", "stocktake": "盘点", "book": "账面",
    "actual": "实际", "diff": "差异", "biz": "业务", "scan": "扫描",
    "opening": "期初", "closing": "期末", "change": "变更", "std": "标准",
    "downstream": "下游", "upstream": "上游", "sub": "子", "submitter": "提交人",
    "parent": "上级", "child": "子级", "batch": "批次", "lot": "批次",
    "forecast": "预测", "replenish": "补货", "allocation": "调拨", "transfer": "调拨",
    "inbound": "入库", "outbound": "出库", "ship": "发货", "receive": "收货",
    "return": "退货", "exchange": "换货", "refund": "退款", "settlement": "结算",
    "balance": "余额", "wallet": "钱包", "coupon": "优惠券", "voucher": "代金券",
    "promotion": "促销", "campaign": "活动", "points": "积分", "score": "积分",
    "grade": "等级", "level": "级别",     "tag": "标签", "label": "标签",
})

# 末批常见词缀补充
KNOWN.update({
    "external": "外部", "shortage": "缺货", "paid": "已付", "cashier": "收银员",
    "cash": "现金", "other": "其他", "deposit": "订金", "req": "申请",
    "requisition": "领料申请", "expected": "预期", "scope": "范围",
    "defective": "次品", "issue": "发放", "reduce": "减免", "recon": "对账",
    "suggested": "建议", "case": "箱", "deal": "成交", "delivered": "已交付",
    "lifecycle": "生命周期", "attr": "属性", "def": "定义", "attr_def": "属性定义",
    "reduce": "减免", "promo": "促销", "omni": "全渠道", "hangtag": "吊牌",
    "subcontract": "外发加工", "production": "生产", "garment": "成衣",
    "month_close": "月结", "finance": "财务", "pos": "POS",
    "qualified": "合格", "object": "对象",
})


def translate_token(tok):
    if tok in KNOWN:
        return KNOWN[tok]
    # 去掉常见复数/变形
    if tok.endswith("s") and tok[:-1] in KNOWN:
        return KNOWN[tok[:-1]]
    return None


def heuristic_cn(name):
    """返回 (中文, 来源)。来源恒为 '推断'（启发式）。"""
    low = name.lower()
    # 1) 整名精确匹配
    if low in KNOWN:
        return KNOWN[low], "推断"
    # 2) 布尔型前缀
    for p in BOOL_PREFIX:
        if low.startswith(p):
            rest = low[len(p):].lstrip("_")
            tr = translate_token(rest)
            if tr:
                return "是否" + tr, "推断"
            # 逐词翻译余下
            parts = [translate_token(x) for x in rest.split("_") if x]
            parts = [p for p in parts if p]
            base = "".join(parts) if parts else rest
            return "是否" + base, "推断"
    # 审计/时间-人 复合模式（高优先级，覆盖每张表都有的 _at/_by 字段）
    if low.endswith("_at") or low.endswith("_time") or low.endswith("_date"):
        prefix = low.rsplit("_", 1)[0]
        if prefix in AUDIT_AT:
            return AUDIT_AT[prefix], "推断"
        tr = [translate_token(t) for t in prefix.split("_") if t]
        tr = [t for t in tr if t]
        return ("".join(tr) + "时间") if tr else "时间", "推断"
    if low.endswith("_by"):
        prefix = low.rsplit("_", 1)[0]
        if prefix in AUDIT_BY:
            return AUDIT_BY[prefix], "推断"
        tr = [translate_token(t) for t in prefix.split("_") if t]
        tr = [t for t in tr if t]
        return ("".join(tr) + "人") if tr else "操作人", "推断"
    # 3) 后缀精确匹配
    for suf, cn in SUFFIX_CN.items():
        if low.endswith(suf):
            prefix = low[: -len(suf)].rstrip("_")
            if not prefix:
                return cn, "推断"
            toks = prefix.split("_")
            tr = [translate_token(t) for t in toks]
            tr = [t for t in tr if t]
            if tr:
                return "".join(tr) + cn, "推断"
            return prefix + cn, "推断"
    # 4) 通用：逐词翻译（去重相邻重复，如 库存库存）
    toks = low.split("_")
    tr = [translate_token(t) for t in toks]
    tr = [t for t in tr if t]
    if tr:
        out = []
        for x in tr:
            if not out or out[-1] != x:
                out.append(x)
        return "".join(out), "推断"
    # 5) 无法推断：保留原名
    return name, "推断"


def heuristic_table_cn(name):
    """表中文名启发式。"""
    low = name.lower()
    if low in KNOWN:
        return KNOWN[low], "推断"
    toks = low.split("_")
    tr = [translate_token(t) for t in toks]
    tr = [t for t in tr if t]
    if tr:
        out = []
        for x in tr:
            if not out or out[-1] != x:
                out.append(x)
        return "".join(out), "推断"
    return name, "推断"


# ----------------------------------------------------------------------------
# 数据库自省
# ----------------------------------------------------------------------------
INTROSPECT_SQL = """
SELECT json_agg(row_to_json(t)) FROM (
  SELECT
    cls.relname AS table_name,
    dsc.description AS table_comment,
    (SELECT json_agg(row_to_json(c)) FROM (
        SELECT
          a.attname AS column_name,
          pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
          (NOT a.attnotnull) AS is_nullable,
          pg_get_expr(ad.adbin, ad.adrelid) AS column_default,
          EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conrelid=cls.oid AND con.contype='p' AND a.attnum = ANY(con.conkey)) AS is_pk,
          col_desc.description AS column_comment
        FROM pg_attribute a
        LEFT JOIN pg_attrdef ad ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
        LEFT JOIN pg_description col_desc ON col_desc.objoid=a.attrelid AND col_desc.objsubid=a.attnum
        WHERE a.attrelid=cls.oid AND a.attnum>0 AND NOT a.attisdropped
        ORDER BY a.attnum
    ) c) AS columns
  FROM pg_class cls
  JOIN pg_namespace n ON n.oid=cls.relnamespace
  LEFT JOIN pg_description dsc ON dsc.objoid=cls.oid AND dsc.objsubid=0
  WHERE n.nspname='public' AND cls.relkind='r'
  ORDER BY cls.relname
) t;
"""


def run_psql(sql, as_json=True):
    env = dict(os.environ)
    env["PGPASSWORD"] = PG["password"]
    cmd = [
        PSQL, "-h", PG["host"], "-p", PG["port"], "-U", PG["user"],
        "-d", PG["dbname"], "-t", "-A", "-c", sql,
    ]
    out = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError("psql failed: " + out.stderr.strip())
    if not as_json:
        return out.stdout
    return json.loads(out.stdout.strip())


def load_dict():
    if os.path.exists(DICT_PATH):
        with open(DICT_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return {"_meta": {}, "tables": {}}


def merge(introspected, existing):
    """合并：已确认的中文优先；缺失用启发式（推断）；已有 DB 注释视作确认。"""
    ex_tables = existing.get("tables", {})
    merged = {}
    inferred_tables = 0
    inferred_cols = 0
    confirmed_cols = 0
    total_cols = 0

    for t in introspected:
        tname = t["table_name"]
        ex_t = ex_tables.get(tname, {})
        # 表中文名（data-dictionary.json 为单一事实源；DB 注释是派生输出，不作为确认依据）
        if ex_t.get("cn") and ex_t.get("src") in ("confirmed", "manual"):
            tcn = ex_t["cn"]; tsrc = ex_t["src"]
        else:
            tcn, tsrc = heuristic_table_cn(tname)
            if tsrc == "推断":
                inferred_tables += 1
        ex_cols = ex_t.get("columns", {})
        merged_cols = {}
        for c in (t["columns"] or []):
            cname = c["column_name"]
            total_cols += 1
            ex_c = ex_cols.get(cname, {})
            if ex_c.get("cn") and ex_c.get("src") in ("confirmed", "manual"):
                cn = ex_c["cn"]; src = ex_c["src"]; confirmed_cols += 1
            else:
                cn, src = heuristic_cn(cname)
                if src == "推断":
                    inferred_cols += 1
                else:
                    confirmed_cols += 1
            merged_cols[cname] = {
                "cn": cn,
                "src": src,
                "desc": ex_c.get("desc", ""),
                # 结构信息（来自 DB，非人工维护）
                "_type": c["data_type"],
                "_nullable": c["is_nullable"],
                "_default": c["column_default"],
                "_pk": c["is_pk"],
                "_db_comment": c.get("column_comment"),
            }
        merged[tname] = {
            "cn": tcn, "src": tsrc, "desc": ex_t.get("desc", ""),
            "columns": merged_cols,
            # 结构信息
            "_db_comment": t.get("table_comment"),
        }
    return merged, dict(
        inferred_tables=inferred_tables, inferred_cols=inferred_cols,
        confirmed_cols=confirmed_cols, total_cols=total_cols,
        total_tables=len(introspected),
    )


def write_dict(merged):
    out = {"_meta": {"note": "ERP 数据字典单一事实源。人工校正：把字段 cn 改准并把 src 改为 confirmed。",
                     "generated_at": datetime.datetime.now().isoformat(timespec="seconds")},
           "tables": {}}
    for tname, t in merged.items():
        cols = {}
        for cname, c in t["columns"].items():
            cols[cname] = {"cn": c["cn"], "src": c["src"], "desc": c.get("desc", "")}
        out["tables"][tname] = {"cn": t["cn"], "src": t["src"], "desc": t.get("desc", ""), "columns": cols}
    with open(DICT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    return out


# ----------------------------------------------------------------------------
# Excel
# ----------------------------------------------------------------------------
def build_excel(merged, stats):
    import openpyxl
    from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()

    HEAD_FILL = PatternFill("solid", fgColor="305496")
    HEAD_FONT = Font(bold=True, color="FFFFFF", size=11)
    TITLE_FONT = Font(bold=True, size=14, color="203864")
    INFER_FILL = PatternFill("solid", fgColor="FFF2CC")
    PK_FILL = PatternFill("solid", fgColor="DDEBF7")
    thin = Side(style="thin", color="BFBFBF")
    BORDER = Border(left=thin, right=thin, top=thin, bottom=thin)
    WRAP = Alignment(vertical="center", wrap_text=True)
    CENTER = Alignment(horizontal="center", vertical="center")

    # ---- Sheet 1: 说明 ----
    ws0 = wb.active
    ws0.title = "说明"
    lines = [
        ("ERP 系统数据字典", TITLE_FONT),
        ("", None),
        ("生成时间：%s" % datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"), None),
        ("数据来源：live erp_db 自省（pg_catalog），为权威表结构", None),
        ("中文来源：data-dictionary.json（人工维护）；缺失项由领域启发式推断并标记为「推断」", None),
        ("", None),
        ("统计：表 %d 张，字段 %d 个；已确认 %d，待校正（推断）%d"
         % (stats["total_tables"], stats["total_cols"], stats["confirmed_cols"], stats["inferred_cols"]), None),
        ("", None),
        ("Sheet 说明：", Font(bold=True)),
        ("  · 字段字典：逐字段中文含义（表名/字段名/中文/类型/可空/默认值/主键/说明/来源）", None),
        ("  · 表清单：每张表的中文名与说明、字段数", None),
        ("  · 待补充：来源为「推断」的字段，需人工校正后把 src 改为 confirmed", None),
        ("", None),
        ("维护约定（表结构变更时）：", Font(bold=True)),
        ("  1. 改表（新增/修改/删除字段）后，重跑 scripts/gen-data-dict.py", None),
        ("  2. 在 data-dictionary.json 中校正「推断」字段的中文，并把 src 改为 confirmed", None),
        ("  3. 重跑脚本，Excel 与数据库 COMMENT 注释会随之迭代；--apply 写入 live DB", None),
        ("  4. 导出 ERP 源码时 data-dictionary.json 与 docs/数据字典.xlsx 一并纳入版本管理", None),
    ]
    for i, (text, font) in enumerate(lines, start=1):
        c = ws0.cell(row=i, column=1, value=text)
        if font:
            c.font = font
    ws0.column_dimensions["A"].width = 110

    # ---- Sheet 2: 字段字典 ----
    ws = wb.create_sheet("字段字典")
    headers = ["序号", "表名", "表中文名", "字段名", "字段中文名", "数据类型",
               "可空", "默认值", "主键", "说明", "中文来源"]
    ws.append(headers)
    for ci, _ in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=ci)
        cell.fill = HEAD_FILL; cell.font = HEAD_FONT
        cell.alignment = CENTER; cell.border = BORDER
    idx = 0
    for tname in sorted(merged.keys()):
        t = merged[tname]
        for cname in sorted(t["columns"].keys()):
            c = t["columns"][cname]
            idx += 1
            row = [
                idx, tname, t["cn"], cname, c["cn"], c.get("_type", ""),
                "是" if c.get("_nullable") else "否",
                (c.get("_default") or ""),
                "是" if c.get("_pk") else "",
                c.get("desc", ""), c["src"],
            ]
            ws.append(row)
            r = ws.max_row
            for ci in range(1, len(headers) + 1):
                cell = ws.cell(row=r, column=ci)
                cell.border = BORDER; cell.alignment = WRAP
            if c.get("_pk"):
                for ci in range(1, len(headers) + 1):
                    ws.cell(row=r, column=ci).fill = PK_FILL
            if c["src"] == "推断":
                ws.cell(row=r, column=5).fill = INFER_FILL
                ws.cell(row=r, column=11).fill = INFER_FILL
    widths = [6, 24, 18, 26, 22, 22, 6, 30, 6, 30, 10]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = "A1:%s%d" % (get_column_letter(len(headers)), ws.max_row)

    # ---- Sheet 3: 表清单 ----
    ws2 = wb.create_sheet("表清单")
    h2 = ["序号", "表名", "表中文名", "表说明", "字段数", "主键字段"]
    ws2.append(h2)
    for ci, _ in enumerate(h2, start=1):
        cell = ws2.cell(row=1, column=ci)
        cell.fill = HEAD_FILL; cell.font = HEAD_FONT
        cell.alignment = CENTER; cell.border = BORDER
    ridx = 0
    for tname in sorted(merged.keys()):
        t = merged[tname]
        cols = t["columns"]
        pk = [k for k, v in cols.items() if v.get("_pk")]
        ridx += 1
        ws2.append([ridx, tname, t["cn"], t.get("desc", ""), len(cols), ", ".join(pk)])
        r = ws2.max_row
        for ci in range(1, len(h2) + 1):
            ws2.cell(row=r, column=ci).border = BORDER
            ws2.cell(row=r, column=ci).alignment = WRAP
    for i, w in enumerate([6, 24, 20, 30, 8, 30], start=1):
        ws2.column_dimensions[get_column_letter(i)].width = w
    ws2.freeze_panes = "A2"

    # ---- Sheet 4: 待补充 ----
    ws3 = wb.create_sheet("待补充")
    h3 = ["表名", "表中文名", "字段名", "数据类型", "推断中文(当前)", "建议修正(人工填)"]
    ws3.append(h3)
    for ci, _ in enumerate(h3, start=1):
        cell = ws3.cell(row=1, column=ci)
        cell.fill = HEAD_FILL; cell.font = HEAD_FONT
        cell.alignment = CENTER; cell.border = BORDER
    for tname in sorted(merged.keys()):
        t = merged[tname]
        for cname in sorted(t["columns"].keys()):
            c = t["columns"][cname]
            if c["src"] == "推断":
                ws3.append([tname, t["cn"], cname, c.get("_type", ""), c["cn"], ""])
                r = ws3.max_row
                for ci in range(1, len(h3) + 1):
                    ws3.cell(row=r, column=ci).border = BORDER
                    ws3.cell(row=r, column=ci).alignment = WRAP
    for i, w in enumerate([24, 18, 26, 22, 24, 30], start=1):
        ws3.column_dimensions[get_column_letter(i)].width = w
    ws3.freeze_panes = "A2"

    os.makedirs(os.path.dirname(XLSX_PATH), exist_ok=True)
    wb.save(XLSX_PATH)


# ----------------------------------------------------------------------------
# COMMENT ON SQL
# ----------------------------------------------------------------------------
def sql_escape(s):
    return s.replace("'", "''")


def build_comment_sql(merged):
    lines = ["-- ERP 数据字典：将中文字段含义写入数据库结构（仅注释，幂等、可重复执行）",
             "-- 生成时间：%s" % datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
             ""]
    for tname in sorted(merged.keys()):
        t = merged[tname]
        if t.get("cn"):
            lines.append('COMMENT ON TABLE "%s" IS \'%s\';' % (tname, sql_escape(t["cn"])))
        for cname in sorted(t["columns"].keys()):
            c = t["columns"][cname]
            if c.get("cn"):
                lines.append('COMMENT ON COLUMN "%s"."%s" IS \'%s\';'
                             % (tname, cname, sql_escape(c["cn"])))
        lines.append("")
    with open(SQL_PATH, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    return SQL_PATH


def apply_comment_sql():
    env = dict(os.environ)
    env["PGPASSWORD"] = PG["password"]
    cmd = [PSQL, "-h", PG["host"], "-p", PG["port"], "-U", PG["user"],
           "-d", PG["dbname"], "-f", SQL_PATH]
    out = subprocess.run(cmd, env=env, capture_output=True, text=True)
    if out.returncode != 0:
        raise RuntimeError("apply comment sql failed: " + out.stderr.strip())
    return out.stdout.strip()


# ----------------------------------------------------------------------------
# main
# ----------------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="ERP 数据字典生成器")
    ap.add_argument("--apply", action="store_true", help="把 COMMENT ON 写入 live erp_db")
    ap.add_argument("--no-write-dict", action="store_true", help="不回写 data-dictionary.json")
    args = ap.parse_args()

    print("[1/5] 自省 live erp_db ...")
    introspected = run_psql(INTROSPECT_SQL)
    print("      表 %d 张" % len(introspected))

    print("[2/5] 合并 data-dictionary.json ...")
    existing = load_dict()
    merged, stats = merge(introspected, existing)
    print("      字段 %d：已确认 %d，推断(待校正) %d"
          % (stats["total_cols"], stats["confirmed_cols"], stats["inferred_cols"]))

    if not args.no_write_dict:
        print("[3/5] 回写 data-dictionary.json ...")
        write_dict(merged)

    print("[4/5] 生成 Excel: %s" % XLSX_PATH)
    build_excel(merged, stats)

    print("[5/5] 生成 COMMENT SQL: %s" % SQL_PATH)
    build_comment_sql(merged)

    if args.apply:
        print("      --apply：写入 live erp_db ...")
        apply_comment_sql()
        print("      数据库注释已更新（pg_description）")

    print("\n完成。待人工校正字段见「待补充」Sheet 与 data-dictionary.json 中 src=推断 的项。")


if __name__ == "__main__":
    main()
